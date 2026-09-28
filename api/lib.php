<?php
declare(strict_types=1);

function cfg(string $k, $default = null) {
    static $c = null;
    if ($c === null) {
        $file = __DIR__ . '/config.php';
        $c = is_file($file) ? require $file : [];
    }
    return $c[$k] ?? $default;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(cfg('db_dsn'), cfg('db_user'), cfg('db_pass'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}

function is_sqlite(): bool { return str_starts_with((string) cfg('db_dsn'), 'sqlite:'); }

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function now(): string { return gmdate('Y-m-d H:i:s'); }

function out($data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400): never { out(['error' => $msg], $code); }

function body(): array {
    static $b = null;
    if ($b === null) {
        $b = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
    }
    return $b;
}

function arg(string $k, int $max = 5000): string {
    $v = body()[$k] ?? $_GET[$k] ?? '';
    $v = trim(is_scalar($v) ? (string) $v : '');
    return mb_substr($v, 0, $max);
}

function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('mm_session');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function current_user(): ?array {
    start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) return null;
    $u = q('SELECT id, email, name, role, verified, banned FROM users WHERE id = ?', [$id])->fetch();
    if (!$u || $u['banned']) {
        unset($_SESSION['uid']);
        return null;
    }
    return $u;
}

function public_user(?array $u): ?array {
    return $u ? ['id' => (int) $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'verified' => (bool) $u['verified']] : null;
}

function require_user(): array {
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    if (!$u['verified']) fail('Confirmez d\'abord votre adresse email (lien reçu par email).', 403);
    return $u;
}

function require_role(string ...$roles): array {
    $u = require_user();
    if (!in_array($u['role'], $roles, true)) fail('Réservé à la modération.', 403);
    return $u;
}

function login_as(int $id): void {
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    // The account of admin_email (api/config.php) becomes administrator when it signs in,
    // once its address is confirmed (so an existing account can be promoted from the configuration)
    $admin = mb_strtolower(trim((string) cfg('admin_email', '')));
    if ($admin !== '') {
        q("UPDATE users SET role = 'admin' WHERE id = ? AND LOWER(email) = ? AND verified = 1 AND role <> 'admin'", [$id, $admin]);
    }
}

// Simple throttle: at most $max events of $kind per key in $minutes
function throttle(string $kind, string $key, int $max, int $minutes): void {
    $since = gmdate('Y-m-d H:i:s', time() - $minutes * 60);
    $n = (int) q('SELECT COUNT(*) FROM throttle WHERE kind = ? AND k = ? AND at > ?', [$kind, $key, $since])->fetchColumn();
    if ($n >= $max) fail('Trop de tentatives, réessayez dans quelques minutes.', 429);
    q('INSERT INTO throttle (kind, k, at) VALUES (?, ?, ?)', [$kind, $key, now()]);
}

function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

function send_mail(string $to, string $subject, string $text, string $html = ''): bool {
    $from = (string) cfg('mail_from', 'no-reply@localhost');
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) $from = 'no-reply@localhost';
    $crlf = fn (string $s) => str_replace("\n", "\r\n", str_replace("\r\n", "\n", $s));
    $headers = ["From: Multi-Motors <$from>", "Reply-To: $from", 'MIME-Version: 1.0', 'X-Mailer: Multi-Motors'];
    if ($html === '') {
        $headers[] = 'Content-Type: text/plain; charset=utf-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        $body = $crlf($text);
    } else {
        // Text and HTML versions: mail apps show the HTML one, the others the text
        $b = 'mm-' . bin2hex(random_bytes(8));
        $headers[] = "Content-Type: multipart/alternative; boundary=\"$b\"";
        $part = fn (string $type, string $content) => "--$b\r\nContent-Type: $type; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($crlf($content))) . "\r\n";
        $body = $part('text/plain', $text) . $part('text/html', $html) . "--$b--\r\n";
    }
    // Envelope sender = the site's address (-f): without it, hosts such as OVH send from a technical
    // address of the cluster and the messages often end up as spam
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers), '-f' . $from);
}

/**
 * HTML email of the site: logo, title, message, one big button and the link written out
 * (tables and inline styles: what every mail app, Outlook included, displays the same way).
 */
function mail_html(string $title, string $hello, string $message, string $button, string $link, string $note): string {
    $site = rtrim((string) cfg('site_url'), '/');
    $e = fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif";
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="color-scheme" content="light only"><title>' . $e($title) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#f2f2f2;">'
        . '<div style="display:none;max-height:0;overflow:hidden;">' . $e($message) . '</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;"><tr><td align="center" style="padding:32px 12px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">'
        . '<tr><td style="background:#111111;padding:22px 32px;" align="left">'
        . '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        . '<td style="padding-right:12px;"><img src="' . $e($site) . '/apple-touch-icon.png" width="44" height="44" alt="" style="display:block;border-radius:10px;background:#fff;"></td>'
        . '<td style="' . $font . ';color:#ffffff;font-size:18px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Multi-Motors</td>'
        . '</tr></table></td></tr>'
        . '<tr><td style="height:5px;background:#ff5757;font-size:0;line-height:0;">&nbsp;</td></tr>'
        . '<tr><td style="padding:34px 32px 8px;' . $font . ';color:#111111;">'
        . '<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;letter-spacing:1px;text-transform:uppercase;">' . $e($title) . '</h1>'
        . '<p style="margin:0 0 12px;font-size:16px;line-height:1.55;">' . $e($hello) . '</p>'
        . '<p style="margin:0 0 26px;font-size:16px;line-height:1.55;color:#333333;">' . $e($message) . '</p>'
        . '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#ff5757;">'
        . '<a href="' . $e($link) . '" style="display:inline-block;padding:16px 30px;' . $font . ';font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:12px;">' . $e($button) . '</a>'
        . '</td></tr></table>'
        . '<p style="margin:26px 0 6px;font-size:13px;line-height:1.5;color:#777777;">Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :</p>'
        . '<p style="margin:0 0 26px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="' . $e($link) . '" style="color:#111111;">' . $e($link) . '</a></p>'
        . '</td></tr>'
        . '<tr><td style="padding:0 32px 30px;' . $font . ';"><p style="margin:0;padding:14px 16px;border-radius:12px;background:#f6f6f6;font-size:13px;line-height:1.5;color:#666666;">' . $e($note) . '</p></td></tr>'
        . '<tr><td style="padding:18px 32px;border-top:1px solid #eeeeee;' . $font . ';font-size:12px;line-height:1.5;color:#999999;" align="center">'
        . 'Multi-Motors — le catalogue des moteurs brushless FPV<br><a href="' . $e($site) . '" style="color:#999999;">' . $e(preg_replace('~^https?://~', '', $site)) . '</a>'
        . '</td></tr></table></td></tr></table></body></html>';
}

/** Email with the link that confirms the address of an account. */
function send_verify_mail(string $email, string $name, string $tok, bool $changed = false): bool {
    $link = rtrim((string) cfg('site_url'), '/') . '/api/index.php?action=verify&token=' . $tok;
    $title = $changed ? 'Confirmez votre nouvelle adresse' : 'Bienvenue sur Multi-Motors';
    $message = $changed ? 'Confirmez votre nouvelle adresse email pour continuer à recevoir les messages du site.'
        : 'Plus qu\'une étape : confirmez votre adresse pour activer votre compte et publier avis, commentaires et corrections.';
    $note = "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message : aucun compte ne sera activé.";
    return send_mail($email, $changed ? 'Confirmez votre nouvelle adresse Multi-Motors' : 'Confirmez votre compte Multi-Motors',
        "Bonjour $name,\n\n$message\n$link\n\n$note\n\nÀ bientôt sur Multi-Motors.",
        mail_html($title, "Bonjour $name,", $message, $changed ? 'Confirmer mon adresse' : 'Activer mon compte', $link, $note));
}

/** Email with the link that lets a member choose a new password (valid 1 hour). */
function send_reset_mail(string $email, string $name, string $tok): bool {
    $link = rtrim((string) cfg('site_url'), '/') . "/#reset/$tok";
    $message = 'Vous avez demandé à changer de mot de passe. Choisissez-en un nouveau grâce au lien ci-dessous, valable 1 heure.';
    $note = "Vous n'avez rien demandé ? Ignorez ce message : votre mot de passe actuel reste valable.";
    return send_mail($email, 'Nouveau mot de passe Multi-Motors', "Bonjour $name,\n\n$message\n$link\n\n$note",
        mail_html('Nouveau mot de passe', "Bonjour $name,", $message, 'Choisir mon mot de passe', $link, $note));
}

function token(): string { return bin2hex(random_bytes(24)); }
