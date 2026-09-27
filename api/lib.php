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
}

// Simple throttle: at most $max events of $kind per key in $minutes
function throttle(string $kind, string $key, int $max, int $minutes): void {
    $since = gmdate('Y-m-d H:i:s', time() - $minutes * 60);
    $n = (int) q('SELECT COUNT(*) FROM throttle WHERE kind = ? AND k = ? AND at > ?', [$kind, $key, $since])->fetchColumn();
    if ($n >= $max) fail('Trop de tentatives, réessayez dans quelques minutes.', 429);
    q('INSERT INTO throttle (kind, k, at) VALUES (?, ?, ?)', [$kind, $key, now()]);
}

function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

function send_mail(string $to, string $subject, string $text): bool {
    $from = cfg('mail_from', 'no-reply@localhost');
    $headers = "From: Multi-Motors <$from>\r\nContent-Type: text/plain; charset=utf-8\r\n";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers);
}

function token(): string { return bin2hex(random_bytes(24)); }
