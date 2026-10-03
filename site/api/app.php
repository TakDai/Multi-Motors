<?php
// Multi-Motors community API (loaded by index.php): accounts, likes, comments, change suggestions,
// moderation and site news. One endpoint: api/index.php?action=<name>
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/schema.php';
require __DIR__ . '/github.php';

const FIELDS = ['NOM', 'VERSION', 'CLASSE', 'KV', 'POIDS', 'D MOTEUR', 'H MOTEUR', 'D SHAFT', 'L SHAFT', 'TYPE SHAFT',
    'VIS HEL', 'VIS FIX', 'ENTRAXE FIX', 'LIPO', 'L CABLE', 'TYPE CABLE', 'HELICE', 'PUISSANCE', 'AMP', 'AIMANT',
    'CLOCHE', 'CONFIG', 'RESISTANCE', 'UTILISATION', 'LIEN', 'IMG', 'AUTRE'];

if (!is_file(__DIR__ . '/config.php')) fail('Les comptes ne sont pas encore ouverts : la base de données du site n\'est pas encore configurée.', 503);

// Configuration and database problems: a clear message instead of an empty error page
// (never the password itself)
foreach (['db_dsn', 'db_user', 'db_pass', 'admin_email'] as $k) {
    if (preg_match('/A_REMPLIR|_ICI\b|XXXX/', (string) cfg($k, ''))) fail("Configuration incomplète : la valeur « $k » de api/config.php n'a pas été remplie.", 503);
}
set_exception_handler(function (Throwable $e): void {
    $msg = 'Erreur du serveur.';
    if ($e instanceof PDOException) {
        $code = (int) ($e->errorInfo[1] ?? 0) ?: (preg_match('/\[(\d{4})\]/', $e->getMessage(), $m) ? (int) $m[1] : 0);
        $msg = match (true) {
            $code === 1045 => 'Connexion à la base refusée : utilisateur ou mot de passe incorrect dans api/config.php.',
            $code === 1044 || $code === 1049 => 'Base de données introuvable : vérifiez le nom de la base (dbname) dans api/config.php.',
            in_array($code, [2002, 2005, 2006], true) => 'Serveur de base introuvable : vérifiez l\'adresse (host) dans api/config.php.',
            default => 'Erreur de base de données (' . ($code ?: 'inconnue') . ').',
        };
    }
    error_log('Multi-Motors API: ' . $e->getMessage());
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json; charset=utf-8'); }
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
});

$action = $_GET['action'] ?? '';
$post = $_SERVER['REQUEST_METHOD'] === 'POST';

// Writes must come from the site itself: a custom header cannot be sent by
// another website without a CORS preflight, which we never allow.
// Exception: the anonymous click counter, sent with navigator.sendBeacon (which cannot add a header)
if ($post && $action !== 'click' && ($_SERVER['HTTP_X_MM'] ?? '') !== '1') fail('Requête refusée.', 403);

try {
    // Tables added after the first install (profiles) are created on the fly too
    db()->query('SELECT 1 FROM users LIMIT 1');
    db()->query('SELECT 1 FROM profiles LIMIT 1');
    db()->query('SELECT 1 FROM garage LIMIT 1');
    db()->query('SELECT rating FROM comments LIMIT 1');
    db()->query('SELECT extra FROM profiles LIMIT 1');
    db()->query('SELECT 1 FROM bugs LIMIT 1');
    db()->query('SELECT perms FROM users LIMIT 1');
    db()->query('SELECT 1 FROM coupons LIMIT 1');
    db()->query('SELECT 1 FROM settings LIMIT 1');
    db()->query('SELECT 1 FROM partners LIMIT 1');
} catch (PDOException $e) {
    install_schema();
}

function ref_arg(): string {
    $ref = arg('ref', 64);
    if ($ref === '' || preg_match('/[\s<>"\']/', $ref)) fail('Moteur inconnu.');
    return $ref;
}

function valid_email(string $e): bool { return (bool) filter_var($e, FILTER_VALIDATE_EMAIL); }

function user_names(array $ids): array {
    if (!$ids) return [];
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $rows = q('SELECT u.id, u.name, u.role, p.color, p.avatar_v, (p.avatar IS NOT NULL) AS has_avatar FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id IN ('
        . implode(',', array_fill(0, count($ids), '?')) . ')', $ids)->fetchAll();
    return array_column($rows, null, 'id');
}

// Avatar address (served by ?action=avatar, cached by version) or '' for the initials
function avatar_url(array $u): string {
    return !empty($u['has_avatar']) ? 'api/index.php?action=avatar&id=' . (int) $u['id'] . '&v=' . (int) ($u['avatar_v'] ?? 0) : '';
}

const FLYING = ['Racing', 'Freestyle', 'Long Range', 'Cinematic', 'Cinewhoop', 'Toothpick', 'Whoop', 'Aile volante', 'Avion', 'Hélicoptère'];
const COLORS = ['#111111', '#ff5757', '#ff9f1c', '#2ec4b6', '#3a86ff', '#8338ec', '#06a77d', '#e63973'];
const LEVELS = ['Débutant', 'Intermédiaire', 'Confirmé', 'Expert', 'Pro'];
const SIZES = ['Whoop', '2″', '2,5″', '3″', '3,5″', '4″', '5″', '6″', '7″', '8″ et +'];
const VIDEO = ['DJI O4', 'DJI O3', 'DJI Vista / Air Unit', 'Walksnail', 'HDZero', 'Analogique'];
const BUG_CATEGORIES = ['Affichage', 'Fiche moteur', 'Prix ou boutique', 'Photo ou vidéo', 'Recherche et filtres', 'Compte et profil', 'Lien cassé', 'Autre'];
const BANNERS = ['couleur', 'coucher', 'ocean', 'foret', 'nuit', 'carbone', 'circuit', 'aurore'];

// Extra pilot details of a profile, only known values (stored as JSON in profiles.extra)
function profile_extra(array $p): array {
    $e = json_decode($p['extra'] ?? '', true);
    return is_array($e) ? $e : [];
}

// Banner address (served by ?action=banner) or '' for the preset
function banner_url(int $id, array $p): string {
    return !empty($p['banner']) ? 'api/index.php?action=banner&id=' . $id . '&v=' . (int) ($p['banner_v'] ?? 0) : '';
}

// A picture sent by the profile editor: small PNG / JPEG / WebP, checked as a real image
function clean_image(string $a, int $max_bytes, int $max_w, int $max_h): string {
    if (!preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$~', $a, $m)) fail('Image refusée : PNG, JPEG ou WebP uniquement.');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > $max_bytes) fail('Image trop lourde (' . round($max_bytes / 1000) . ' Ko au maximum).');
    $info = @getimagesizefromstring($bin);
    if (!$info || $info[0] > $max_w || $info[1] > $max_h || !in_array($info['mime'], ['image/png', 'image/jpeg', 'image/webp'], true)) fail('Image illisible ou trop grande.');
    return 'data:' . $info['mime'] . ';base64,' . base64_encode($bin);
}

function clean_url(string $v, string $host = ''): string {
    if ($v === '') return '';
    if (!preg_match('~^https?://~i', $v)) $v = 'https://' . $v;
    $p = parse_url($v);
    if (!filter_var($v, FILTER_VALIDATE_URL) || empty($p['host']) || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true)) fail('Lien invalide : ' . $v);
    if ($host !== '' && !preg_match('~(^|\.)' . preg_quote($host, '~') . '$~i', $p['host'])) fail("Le lien doit mener à $host.");
    return mb_substr($v, 0, 200);
}

function profile_row(int $id): array {
    return q('SELECT * FROM profiles WHERE user_id = ?', [$id])->fetch() ?: [];
}

// What every page needs from the server besides the session: banner, open features, role names, promo codes
function site_public(): array {
    $today = gmdate('Y-m-d');
    $coupons = q("SELECT id, code, shop, discount, title, url, brand, ends FROM coupons WHERE active = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends >= ?) ORDER BY shop, id", [$today, $today])->fetchAll();
    return [
        'announce' => setting('announce_on') === '1' && setting('announce_text') !== ''
            ? ['text' => setting('announce_text'), 'link' => setting('announce_link'), 'kind' => setting('announce_kind', 'info')] : null,
        'registrations' => setting('registrations', '1') === '1',
        'comments' => setting('comments', '1') === '1',
        'roles' => array_map(fn ($r) => ['label' => $r['label'], 'color' => $r['color']], roles_all()),
        'partners' => array_map(fn ($p) => ['shop' => $p['shop'], 'domain' => $p['domain'] ?? '', 'link' => $p['link']],
            q('SELECT shop, domain, link FROM partners WHERE active = 1 ORDER BY shop')->fetchAll()),
        'coupons' => array_map(fn ($c) => ['id' => (int) $c['id']] + array_filter($c, fn ($v, $k) => $k !== 'id' && $v !== null && $v !== '', ARRAY_FILTER_USE_BOTH), $coupons),
    ];
}

function coupon_state(array $c): string {
    $today = gmdate('Y-m-d');
    return !$c['active'] ? 'off' : ($c['starts'] && $c['starts'] > $today ? 'later' : ($c['ends'] && $c['ends'] < $today ? 'expired' : 'on'));
}

// A member the team member $a may change: never themself, an administrator only by an administrator
function editable_user(array $a, int $id): array {
    if ($id === (int) $a['id']) fail('Vous ne pouvez pas modifier votre propre compte ici.');
    $t = q('SELECT id, email, name, role, perms, verified, banned FROM users WHERE id = ?', [$id])->fetch();
    if (!$t) fail('Membre introuvable.', 404);
    if ($t['role'] === 'admin' && $a['role'] !== 'admin') fail('Seul un administrateur peut modifier un autre administrateur.', 403);
    return $t;
}

// Nobody gives more than they have: a role or permissions are given only by someone who holds them all
function check_grant(array $a, array $perms): void {
    if ($a['role'] === 'admin') return;
    $over = array_diff($perms, perms_of($a));
    if ($over) fail('Vous ne pouvez pas donner une permission que vous n\'avez pas : ' . implode(', ', array_map(fn ($p) => PERMS[$p] ?? $p, $over)) . '.', 403);
}

function me_payload(?array $u): ?array {
    if (!$u) return null;
    $p = profile_row((int) $u['id']);
    return public_user($u) + ['color' => $p['color'] ?? '', 'avatar' => avatar_url(['id' => $u['id'], 'has_avatar' => !empty($p['avatar']), 'avatar_v' => $p['avatar_v'] ?? 0])];
}

switch ($action) {

// ---------------------------------------------------------------- accounts
case 'me':
    out(['user' => me_payload(current_user()), 'google_client_id' => cfg('google_client_id', ''), 'site' => site_public()]);

case 'register':
    if (!$post) fail('POST attendu.', 405);
    throttle('register', client_ip(), 5, 60);
    $email = mb_strtolower(arg('email', 190));
    $name = arg('name', 40);
    $pass = (string) (body()['password'] ?? '');
    if (!valid_email($email)) fail('Adresse email invalide.');
    if (mb_strlen($name) < 2) fail('Choisissez un pseudo d\'au moins 2 caractères.');
    if (strlen($pass) < 8) fail('Le mot de passe doit faire au moins 8 caractères.');
    if (setting('registrations', '1') !== '1') fail('Les inscriptions sont fermées pour le moment.', 403);
    if (arg('accept') !== '1') fail('Acceptez les conditions d\'utilisation et la politique de confidentialité pour créer un compte.');
    purge_unverified();
    if (q('SELECT id FROM users WHERE email = ?', [$email])->fetch()) fail('Un compte existe déjà avec cette adresse.');
    $tok = token();
    $role = $email === mb_strtolower((string) cfg('admin_email', '')) ? 'admin' : 'user';
    q('INSERT INTO users (email, name, pass_hash, role, verified, verify_token, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [$email, $name, password_hash($pass, PASSWORD_DEFAULT), $role, $tok, now()]);
    send_verify_mail($email, $name, $tok);
    login_as((int) db()->lastInsertId());
    out(['user' => me_payload(current_user()), 'message' => 'Compte créé. Un lien de confirmation vous a été envoyé par email.']);

case 'verify':
    $tok = arg('token', 64);
    $u = $tok ? q('SELECT id FROM users WHERE verify_token = ?', [$tok])->fetch() : null;
    if ($u) {
        q('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?', [$u['id']]);
        login_as((int) $u['id']);
    }
    header('Location: ' . rtrim((string) cfg('site_url'), '/') . '/#' . ($u ? 'compte-confirme' : 'lien-invalide'));
    exit;

case 'resend_verify':
    // A new confirmation link for the signed-in member whose address is not confirmed yet
    if (!$post) fail('POST attendu.', 405);
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    if ($u['verified']) out(['message' => 'Votre adresse est déjà confirmée.']);
    throttle('resend_verify', (string) $u['id'], 3, 60);
    $tok = token();
    q('UPDATE users SET verify_token = ? WHERE id = ?', [$tok, $u['id']]);
    $sent = send_verify_mail((string) $u['email'], (string) $u['name'], $tok);
    if (!$sent) fail('L\'email n\'a pas pu être envoyé. Réessayez plus tard.', 500);
    out(['message' => 'Un nouveau lien de confirmation vient d\'être envoyé à ' . $u['email'] . '.']);

case 'login':
    if (!$post) fail('POST attendu.', 405);
    $email = mb_strtolower(arg('email', 190));
    throttle('login', client_ip() . '|' . $email, 8, 15);
    $u = q('SELECT id, pass_hash, banned FROM users WHERE email = ?', [$email])->fetch();
    if (!$u || !$u['pass_hash'] || !password_verify((string) (body()['password'] ?? ''), $u['pass_hash'])) fail('Email ou mot de passe incorrect.', 401);
    if ($u['banned']) fail('Ce compte a été suspendu.', 403);
    login_as((int) $u['id']);
    out(['user' => me_payload(current_user())]);

case 'logout':
    start_session();
    $_SESSION = [];
    session_destroy();
    out(['user' => null]);

case 'google':
    if (!$post) fail('POST attendu.', 405);
    $cid = (string) cfg('google_client_id', '');
    if ($cid === '') fail('Connexion Google non configurée.', 503);
    $cred = arg('credential', 4000);
    $ch = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($cred));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $info = json_decode((string) curl_exec($ch), true) ?: [];
    if (($info['aud'] ?? '') !== $cid || ($info['email_verified'] ?? '') !== 'true' || empty($info['sub'])) fail('Connexion Google refusée.', 401);
    $email = mb_strtolower($info['email']);
    $u = q('SELECT id, banned FROM users WHERE google_sub = ? OR email = ?', [$info['sub'], $email])->fetch();
    if ($u) {
        if ($u['banned']) fail('Ce compte a été suspendu.', 403);
        q('UPDATE users SET google_sub = ?, verified = 1 WHERE id = ?', [$info['sub'], $u['id']]);
        $id = (int) $u['id'];
    } else {
        if (setting('registrations', '1') !== '1') fail('Les inscriptions sont fermées pour le moment.', 403);
        $role = $email === mb_strtolower((string) cfg('admin_email', '')) ? 'admin' : 'user';
        $name = mb_substr($info['given_name'] ?? $info['name'] ?? explode('@', $email)[0], 0, 40);
        q('INSERT INTO users (email, name, google_sub, role, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)', [$email, $name, $info['sub'], $role, now()]);
        $id = (int) db()->lastInsertId();
    }
    login_as($id);
    out(['user' => me_payload(current_user())]);

case 'forgot':
    if (!$post) fail('POST attendu.', 405);
    $email = mb_strtolower(arg('email', 190));
    throttle('forgot', client_ip(), 5, 60);
    $u = q('SELECT id, name FROM users WHERE email = ?', [$email])->fetch();
    if ($u) {
        $tok = token();
        q('UPDATE users SET reset_token = ?, reset_until = ? WHERE id = ?', [$tok, gmdate('Y-m-d H:i:s', time() + 3600), $u['id']]);
        send_reset_mail($email, (string) $u['name'], $tok);
    }
    out(['message' => 'Si un compte existe avec cette adresse, un lien vient de lui être envoyé.']);

case 'reset':
    if (!$post) fail('POST attendu.', 405);
    $pass = (string) (body()['password'] ?? '');
    if (strlen($pass) < 8) fail('Le mot de passe doit faire au moins 8 caractères.');
    $u = q('SELECT id FROM users WHERE reset_token = ? AND reset_until > ?', [arg('token', 64), now()])->fetch();
    if (!$u) fail('Lien expiré ou invalide.');
    q('UPDATE users SET pass_hash = ?, reset_token = NULL, reset_until = NULL, verified = 1 WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    login_as((int) $u['id']);
    out(['user' => me_payload(current_user()), 'message' => 'Mot de passe modifié.']);

// ------------------------------------------------------------ public reads
case 'motor':
    // Everything the motor page needs in one call
    $ref = ref_arg();
    $me = current_user();
    $likes = (int) q('SELECT COUNT(*) FROM likes WHERE ref = ?', [$ref])->fetchColumn();
    $liked = $me ? (bool) q('SELECT 1 FROM likes WHERE ref = ? AND user_id = ?', [$ref, $me['id']])->fetchColumn() : false;
    $mod = can($me, 'comments');
    $rows = q('SELECT id, user_id, body, status, created_at, rating, pros, cons FROM comments WHERE ref = ?' . ($mod ? " AND status <> 'deleted'" : " AND status = 'visible'") . ' ORDER BY id DESC LIMIT 200', [$ref])->fetchAll();
    $names = user_names(array_column($rows, 'user_id'));
    $comments = array_map(fn ($c) => [
        'id' => (int) $c['id'], 'body' => $c['body'], 'status' => $c['status'], 'at' => $c['created_at'],
        'author' => $names[$c['user_id']]['name'] ?? 'Membre', 'role' => $names[$c['user_id']]['role'] ?? 'user',
        'uid' => isset($names[$c['user_id']]) ? (int) $c['user_id'] : 0, 'color' => $names[$c['user_id']]['color'] ?? '',
        'avatar' => isset($names[$c['user_id']]) ? avatar_url($names[$c['user_id']]) : '',
        'mine' => $me && (int) $c['user_id'] === (int) $me['id'],
        'rating' => $c['rating'] !== null ? (int) $c['rating'] : null, 'pros' => $c['pros'] ?? '', 'cons' => $c['cons'] ?? '',
    ], $rows);
    $rated = array_filter(array_column($comments, 'rating'));
    $garage = ['owned' => 0, 'tested' => 0, 'wanted' => 0];
    foreach (q('SELECT status, COUNT(*) AS n FROM garage WHERE ref = ? GROUP BY status', [$ref])->fetchAll() as $g) $garage[$g['status']] = (int) $g['n'];
    $mine = $me ? q('SELECT status, note FROM garage WHERE ref = ? AND user_id = ?', [$ref, $me['id']])->fetch() : null;
    $pending = (int) q("SELECT COUNT(*) FROM suggestions WHERE ref = ? AND status = 'pending'", [$ref])->fetchColumn();
    out(['likes' => $likes, 'liked' => $liked, 'comments' => $comments, 'pending_suggestions' => $pending,
        'rating' => $rated ? round(array_sum($rated) / count($rated), 1) : null, 'ratings' => count($rated),
        'garage' => $garage, 'mine' => $mine ?: null]);

case 'likes':
    // Like counts of every motor (used to sort by popularity)
    $rows = q('SELECT ref, COUNT(*) AS n FROM likes GROUP BY ref')->fetchAll();
    out(array_map('intval', array_column($rows, 'n', 'ref')));

case 'overrides':
    // Approved community changes, applied on top of the catalogue by the site
    $rows = q("SELECT ref, field, new_value FROM suggestions WHERE status = 'approved' AND field <> 'AUTRE' ORDER BY reviewed_at, id")->fetchAll();
    $o = [];
    foreach ($rows as $r) $o[$r['ref']][$r['field']] = $r['new_value'];
    out($o);

case 'news':
    $rows = q('SELECT id, title, body, author_id, created_at FROM news WHERE published = 1 ORDER BY id DESC LIMIT 50')->fetchAll();
    $names = user_names(array_column($rows, 'author_id'));
    out(array_map(fn ($n) => ['id' => (int) $n['id'], 'title' => $n['title'], 'body' => $n['body'], 'at' => $n['created_at'],
        'author' => $names[$n['author_id']]['name'] ?? 'Multi-Motors'], $rows));

// ---------------------------------------------------------------- profiles
case 'profile':
    // Public page of a member (the owner and the moderation always see it)
    $id = (int) arg('id');
    $u = q('SELECT id, name, role, created_at, banned FROM users WHERE id = ?', [$id])->fetch();
    if (!$u || $u['banned']) fail('Ce membre n\'existe pas ou plus.', 404);
    $me = current_user();
    $p = profile_row($id);
    $mine = $me && (int) $me['id'] === $id;
    $public = ($p['is_public'] ?? 1) || $mine || can($me, 'members');
    $extra = profile_extra($p);
    $base = ['id' => $id, 'name' => $u['name'], 'role' => $u['role'], 'since' => $u['created_at'], 'mine' => $mine,
        'color' => $p['color'] ?? '', 'avatar' => avatar_url(['id' => $id, 'has_avatar' => !empty($p['avatar']), 'avatar_v' => $p['avatar_v'] ?? 0]),
        'banner' => banner_url($id, $p), 'banner_preset' => $extra['banner_preset'] ?? ''];
    if (!$public) out($base + ['private' => true]);
    $stats = [
        'comments' => (int) q("SELECT COUNT(*) FROM comments WHERE user_id = ? AND status = 'visible'", [$id])->fetchColumn(),
        'approved' => (int) q("SELECT COUNT(*) FROM suggestions WHERE user_id = ? AND status = 'approved'", [$id])->fetchColumn(),
        'suggestions' => (int) q('SELECT COUNT(*) FROM suggestions WHERE user_id = ?', [$id])->fetchColumn(),
        'likes' => (int) q('SELECT COUNT(*) FROM likes WHERE user_id = ?', [$id])->fetchColumn(),
    ];
    $comments = q("SELECT id, ref, body, rating, created_at AS at FROM comments WHERE user_id = ? AND status = 'visible' ORDER BY id DESC LIMIT 10", [$id])->fetchAll();
    $likes = ($p['show_likes'] ?? 1) || $mine ? array_column(q('SELECT ref FROM likes WHERE user_id = ? ORDER BY created_at DESC LIMIT 24', [$id])->fetchAll(), 'ref') : [];
    out($base + [
        'bio' => $p['bio'] ?? '', 'location' => $p['location'] ?? '', 'website' => $p['website'] ?? '', 'youtube' => $p['youtube'] ?? '',
        'instagram' => $p['instagram'] ?? '', 'flying' => $p['flying'] ?? '', 'setup' => json_decode($p['setup'] ?? '[]', true) ?: [],
        'is_public' => (bool) ($p['is_public'] ?? 1), 'show_likes' => (bool) ($p['show_likes'] ?? 1),
        'extra' => (object) array_diff_key($extra, ['banner_preset' => 1]),
        'stats' => $stats, 'comments' => $comments, 'likes' => $likes,
        'garage' => q("SELECT ref, status, note FROM garage WHERE user_id = ? AND status IN ('owned', 'tested') ORDER BY created_at DESC LIMIT 60", [$id])->fetchAll(),
    ]);

case 'avatar':
    $row = q('SELECT avatar FROM profiles WHERE user_id = ?', [(int) arg('id')])->fetch();
    if (!$row || !preg_match('~^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$~', (string) $row['avatar'], $m)) { http_response_code(404); exit; }
    header('Content-Type: ' . $m[1]);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=604800');
    echo base64_decode($m[2]);
    exit;

case 'banner':
    $row = q('SELECT banner FROM profiles WHERE user_id = ?', [(int) arg('id')])->fetch();
    if (!$row || !preg_match('~^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$~', (string) $row['banner'], $m)) { http_response_code(404); exit; }
    header('Content-Type: ' . $m[1]);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=604800');
    echo base64_decode($m[2]);
    exit;

case 'profile_save':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $b = body();
    $old = profile_row((int) $u['id']);
    $flying = arg('flying', 30);
    if ($flying !== '' && !in_array($flying, FLYING, true)) fail('Type de vol inconnu.');
    $color = arg('color', 7);
    if ($color !== '' && !in_array($color, COLORS, true)) fail('Couleur inconnue.');
    $setup = array_values(array_unique(array_filter(array_map(fn ($r) => mb_substr(trim((string) $r), 0, 64), is_array($b['setup'] ?? null) ? $b['setup'] : []),
        fn ($r) => $r !== '' && !preg_match('/[\s<>"\']/', $r))));
    if (count($setup) > 8) fail('8 moteurs au maximum dans votre setup.');
    $avatar = $old['avatar'] ?? null;
    $version = (int) ($old['avatar_v'] ?? 0);
    if (array_key_exists('avatar', $b)) {
        $a = (string) $b['avatar'];
        $avatar = $a === '' ? null : clean_image($a, 200000, 1024, 1024);
        $version++;
    }
    $banner = $old['banner'] ?? null;
    $banner_v = (int) ($old['banner_v'] ?? 0);
    if (array_key_exists('banner', $b)) {
        $a = (string) $b['banner'];
        $banner = $a === '' ? null : clean_image($a, 450000, 2000, 800);
        $banner_v++;
    }
    // Pilot details: only known values are kept
    $extra = profile_extra($old);
    if (is_array($b['extra'] ?? null)) {
        $e = $b['extra'];
        $str = fn ($k, $max) => mb_substr(trim(is_scalar($e[$k] ?? '') ? (string) ($e[$k] ?? '') : ''), 0, $max);
        $list = fn ($k, $allowed) => array_values(array_intersect($allowed, is_array($e[$k] ?? null) ? $e[$k] : []));
        $year = (int) ($e['pilot_since'] ?? 0);
        $extra = array_filter([
            'pilot_since' => $year >= 1990 && $year <= (int) date('Y') ? $year : null,
            'level' => in_array($str('level', 20), LEVELS, true) ? $str('level', 20) : null,
            'styles' => $list('styles', FLYING), 'sizes' => $list('sizes', SIZES),
            'video' => in_array($str('video', 30), VIDEO, true) ? $str('video', 30) : null,
            'radio' => $str('radio', 60), 'goggles' => $str('goggles', 60), 'drones' => $str('drones', 400),
            'tiktok' => clean_url($str('tiktok', 200), 'tiktok.com'), 'twitch' => clean_url($str('twitch', 200), 'twitch.tv'),
            'discord' => preg_replace('/[<>"\'\s]/', '', $str('discord', 40)),
            'banner_preset' => in_array($str('banner_preset', 12), BANNERS, true) ? $str('banner_preset', 12) : null,
        ], fn ($v) => $v !== null && $v !== '' && $v !== []);
        // The first style chosen is the main one (shown under the name)
        $flying = $extra['styles'][0] ?? '';
        $b['flying'] = $flying;
    }
    // Only the fields sent are changed; the others keep their saved value
    $keep = fn (string $k, $new, string $col = '') => array_key_exists($k, $b) ? $new : ($old[$col ?: $k] ?? null);
    $vals = [$keep('bio', arg('bio', 280)), $keep('location', arg('location', 60)), $keep('website', clean_url(arg('website', 200))),
        $keep('youtube', clean_url(arg('youtube', 200), 'youtube.com')), $keep('instagram', clean_url(arg('instagram', 200), 'instagram.com')),
        $keep('color', $color ?: null), $avatar, $version, $keep('setup', json_encode($setup)), $keep('flying', $flying ?: null),
        $keep('is_public', arg('is_public') === '0' ? 0 : 1) ?? 1, $keep('show_likes', arg('show_likes') === '0' ? 0 : 1) ?? 1, now(),
        $banner, $banner_v, $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null];
    if ($old) {
        q('UPDATE profiles SET bio = ?, location = ?, website = ?, youtube = ?, instagram = ?, color = ?, avatar = ?, avatar_v = ?, setup = ?, flying = ?, is_public = ?, show_likes = ?, updated_at = ?, banner = ?, banner_v = ?, extra = ? WHERE user_id = ?',
            array_merge($vals, [$u['id']]));
    } else {
        q('INSERT INTO profiles (bio, location, website, youtube, instagram, color, avatar, avatar_v, setup, flying, is_public, show_likes, updated_at, banner, banner_v, extra, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            array_merge($vals, [$u['id']]));
    }
    out(['user' => me_payload(current_user()), 'message' => 'Profil enregistré.']);

// ------------------------------------------------------- personal space
case 'garage_set':
    // "My motors": owned, tested or wanted, with a short note; empty status removes it
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $ref = ref_arg();
    $status = arg('status', 10);
    if ($status === '') {
        q('DELETE FROM garage WHERE user_id = ? AND ref = ?', [$u['id'], $ref]);
        out(['mine' => null]);
    }
    if (!in_array($status, ['owned', 'tested', 'wanted'], true)) fail('Statut inconnu.');
    $note = arg('note', 200);
    if (q('SELECT 1 FROM garage WHERE user_id = ? AND ref = ?', [$u['id'], $ref])->fetchColumn()) {
        q('UPDATE garage SET status = ?, note = ? WHERE user_id = ? AND ref = ?', [$status, $note ?: null, $u['id'], $ref]);
    } else {
        if ((int) q('SELECT COUNT(*) FROM garage WHERE user_id = ?', [$u['id']])->fetchColumn() >= 300) fail('300 moteurs au maximum.');
        q('INSERT INTO garage (user_id, ref, status, note, created_at) VALUES (?, ?, ?, ?, ?)', [$u['id'], $ref, $status, $note ?: null, now()]);
    }
    out(['mine' => ['status' => $status, 'note' => $note]]);

case 'view':
    // Motor pages seen by a signed-in member (the 60 most recent are kept)
    if (!$post) fail('POST attendu.', 405);
    $u = current_user();
    if (!$u) out(['ok' => false]);
    $ref = ref_arg();
    q('DELETE FROM history WHERE user_id = ? AND ref = ?', [$u['id'], $ref]);
    q('INSERT INTO history (user_id, ref, at) VALUES (?, ?, ?)', [$u['id'], $ref, now()]);
    $old = q('SELECT at FROM history WHERE user_id = ? ORDER BY at DESC LIMIT 1 OFFSET 59', [$u['id']])->fetchColumn();
    if ($old) q('DELETE FROM history WHERE user_id = ? AND at < ?', [$u['id'], $old]);
    out(['ok' => true]);

case 'history_clear':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    q('DELETE FROM history WHERE user_id = ?', [$u['id']]);
    out(['ok' => true]);

case 'my_space':
    // Everything of "Mon espace" in one call
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    out([
        'history' => q('SELECT ref, at FROM history WHERE user_id = ? ORDER BY at DESC LIMIT 60', [$u['id']])->fetchAll(),
        'likes' => array_column(q('SELECT ref FROM likes WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [$u['id']])->fetchAll(), 'ref'),
        'garage' => q('SELECT ref, status, note, created_at AS at FROM garage WHERE user_id = ? ORDER BY created_at DESC', [$u['id']])->fetchAll(),
        'reviews' => q("SELECT id, ref, body, rating, pros, cons, created_at AS at FROM comments WHERE user_id = ? AND status = 'visible' ORDER BY id DESC LIMIT 100", [$u['id']])->fetchAll(),
    ]);

case 'account_update':
    if (!$post) fail('POST attendu.', 405);
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    $full = q('SELECT pass_hash, email FROM users WHERE id = ?', [$u['id']])->fetch();
    $pass = (string) (body()['current'] ?? '');
    $checkPass = function () use ($full, $pass) {
        if ($full['pass_hash'] && !password_verify($pass, $full['pass_hash'])) fail('Mot de passe actuel incorrect.', 403);
    };
    throttle('account', (string) $u['id'], 10, 15);
    $msg = [];
    $name = arg('name', 40);
    if ($name !== '' && $name !== $u['name']) {
        if (mb_strlen($name) < 2) fail('Choisissez un pseudo d\'au moins 2 caractères.');
        q('UPDATE users SET name = ? WHERE id = ?', [$name, $u['id']]);
        $msg[] = 'Pseudo modifié.';
    }
    $email = mb_strtolower(arg('email', 190));
    if ($email !== '' && $email !== $full['email']) {
        $checkPass();
        if (!valid_email($email)) fail('Adresse email invalide.');
        if (q('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $u['id']])->fetch()) fail('Cette adresse est déjà utilisée.');
        $tok = token();
        q('UPDATE users SET email = ?, verified = 0, verify_token = ? WHERE id = ?', [$email, $tok, $u['id']]);
        send_verify_mail($email, (string) $u['name'], $tok, true);
        $msg[] = 'Adresse modifiée : confirmez-la avec le lien envoyé par email.';
    }
    $new = (string) (body()['password'] ?? '');
    if ($new !== '') {
        $checkPass();
        if (strlen($new) < 8) fail('Le nouveau mot de passe doit faire au moins 8 caractères.');
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
        $msg[] = 'Mot de passe modifié.';
    }
    out(['user' => me_payload(current_user()), 'message' => $msg ? implode(' ', $msg) : 'Rien à modifier.']);

case 'my_data':
    // Everything the site keeps about the member, as a JSON file (right of access and portability)
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    $id = (int) $u['id'];
    $acc = q('SELECT id, email, name, role, verified, created_at, last_seen, admin_note AS note_de_l_equipe FROM users WHERE id = ?', [$id])->fetch();
    $prof = profile_row($id);
    unset($prof['user_id']);
    $prof['extra'] = profile_extra($prof);
    $data = [
        'site' => 'https://multi-motors.fr', 'exporte_le' => gmdate('c'), 'compte' => $acc, 'profil' => $prof ?: null,
        'jaime' => q('SELECT ref, created_at FROM likes WHERE user_id = ?', [$id])->fetchAll(),
        'mes_moteurs' => q('SELECT ref, status, note, created_at FROM garage WHERE user_id = ?', [$id])->fetchAll(),
        'historique' => q('SELECT ref, at FROM history WHERE user_id = ?', [$id])->fetchAll(),
        'avis' => q('SELECT ref, body, rating, pros, cons, status, created_at FROM comments WHERE user_id = ?', [$id])->fetchAll(),
        'corrections_proposees' => q('SELECT ref, field, old_value, new_value, source, note, status, created_at FROM suggestions WHERE user_id = ?', [$id])->fetchAll(),
        'signalements_de_bug' => q('SELECT category, body, url, status, created_at FROM bugs WHERE user_id = ?', [$id])->fetchAll(),
    ];
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="multi-motors-mes-donnees.json"');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;

case 'account_delete':
    if (!$post) fail('POST attendu.', 405);
    $u = current_user();
    if (!$u) fail('Connectez-vous pour faire cela.', 401);
    if (arg('confirm') !== 'SUPPRIMER') fail('Tapez SUPPRIMER pour confirmer.');
    $full = q('SELECT pass_hash FROM users WHERE id = ?', [$u['id']])->fetch();
    if ($full['pass_hash'] && !password_verify((string) (body()['current'] ?? ''), $full['pass_hash'])) fail('Mot de passe incorrect.', 403);
    // Likes and profile go; comments are removed; validated corrections stay in the catalogue, without a name
    q('DELETE FROM likes WHERE user_id = ?', [$u['id']]);
    q('DELETE FROM profiles WHERE user_id = ?', [$u['id']]);
    q('DELETE FROM garage WHERE user_id = ?', [$u['id']]);
    q('DELETE FROM history WHERE user_id = ?', [$u['id']]);
    q('UPDATE bugs SET user_id = NULL, email = NULL WHERE user_id = ?', [$u['id']]);
    q('DELETE FROM comments WHERE user_id = ?', [$u['id']]);
    // Corrections already reviewed stay in the catalogue's history, without any link to the account
    q("DELETE FROM suggestions WHERE user_id = ? AND status = 'pending'", [$u['id']]);
    q('UPDATE suggestions SET user_id = 0, note = NULL WHERE user_id = ?', [$u['id']]);
    q('DELETE FROM users WHERE id = ?', [$u['id']]);
    start_session();
    $_SESSION = [];
    session_destroy();
    out(['user' => null, 'message' => 'Votre compte a été supprimé.']);

// --------------------------------------------------------- member actions
case 'like':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $ref = ref_arg();
    if (q('SELECT 1 FROM likes WHERE user_id = ? AND ref = ?', [$u['id'], $ref])->fetchColumn()) {
        q('DELETE FROM likes WHERE user_id = ? AND ref = ?', [$u['id'], $ref]);
        $liked = false;
    } else {
        q('INSERT INTO likes (user_id, ref, created_at) VALUES (?, ?, ?)', [$u['id'], $ref, now()]);
        $liked = true;
    }
    out(['liked' => $liked, 'likes' => (int) q('SELECT COUNT(*) FROM likes WHERE ref = ?', [$ref])->fetchColumn()]);

case 'comment':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $ref = ref_arg();
    $text = arg('body', 2000);
    $pros = arg('pros', 600);
    $cons = arg('cons', 600);
    $rating = (int) arg('rating');
    if ($rating < 0 || $rating > 5) fail('Note invalide.');
    if (mb_strlen($text) < 3 && $pros === '' && $cons === '') fail('Votre avis est vide.');
    if (setting('comments', '1') !== '1' && !is_staff($u)) fail('Les avis sont fermés pour le moment.', 403);
    throttle('comment', (string) $u['id'], 5, 10);
    q('INSERT INTO comments (ref, user_id, body, status, created_at, rating, pros, cons) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$ref, $u['id'], $text, 'visible', now(), $rating ?: null, $pros ?: null, $cons ?: null]);
    out(['ok' => true]);

case 'comment_delete':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $c = q('SELECT user_id FROM comments WHERE id = ?', [(int) arg('id')])->fetch();
    if (!$c) fail('Commentaire introuvable.', 404);
    if ((int) $c['user_id'] !== (int) $u['id'] && !can($u, 'comments')) fail('Action non autorisée.', 403);
    q("UPDATE comments SET status = 'deleted' WHERE id = ?", [(int) arg('id')]);
    if ((int) $c['user_id'] !== (int) $u['id']) audit('comment.deleted', 'avis #' . (int) arg('id'));
    out(['ok' => true]);

case 'suggest':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $ref = ref_arg();
    $field = arg('field', 30);
    if (!in_array($field, FIELDS, true)) fail('Champ inconnu.');
    $value = arg('value', 255);
    if ($value === '') fail('Indiquez la nouvelle valeur.');
    throttle('suggest', (string) $u['id'], 20, 60);
    q('INSERT INTO suggestions (ref, user_id, field, old_value, new_value, source, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$ref, $u['id'], $field, arg('old', 255), $value, arg('source', 500), arg('note', 1000), 'pending', now()]);
    out(['message' => 'Merci ! Votre suggestion sera vérifiée par la modération.']);

// --------------------------------------------------------------- bug reports
case 'bug_report':
    // Open to every visitor (signed in or not); the element picked on the page comes with its CSS path
    if (!$post) fail('POST attendu.', 405);
    throttle('bug', client_ip(), 6, 60);
    $cat = arg('category', 40);
    if (!in_array($cat, BUG_CATEGORIES, true)) fail('Choisissez une catégorie.');
    $body = arg('body', 3000);
    if (mb_strlen($body) < 10) fail('Décrivez le problème en quelques mots (10 caractères au moins).');
    $email = mb_strtolower(arg('email', 190));
    if ($email !== '' && !valid_email($email)) fail('Adresse email invalide.');
    $me = current_user();
    q('INSERT INTO bugs (user_id, category, body, url, selector, snippet, element_text, viewport, agent, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$me['id'] ?? null, $cat, $body, arg('url', 500), arg('selector', 500), arg('snippet', 2000), arg('element_text', 300),
         arg('viewport', 30), mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300), $email ?: null, 'open', now()]);
    out(['message' => 'Le signalement a été envoyé à l\'équipe du site.']);

case 'admin_bugs':
    require_perm('bugs');
    $status = in_array(arg('status'), ['open', 'done', 'rejected'], true) ? arg('status') : 'open';
    $rows = q('SELECT * FROM bugs WHERE status = ? ORDER BY id DESC LIMIT 300', [$status])->fetchAll();
    $names = user_names(array_filter(array_column($rows, 'user_id')));
    foreach ($rows as &$r) $r['author'] = $r['user_id'] ? ($names[$r['user_id']]['name'] ?? '?') : null;
    out($rows);

case 'bug_update':
    if (!$post) fail('POST attendu.', 405);
    require_perm('bugs');
    $status = arg('status');
    if (!in_array($status, ['open', 'done', 'rejected', 'deleted'], true)) fail('Statut inconnu.');
    if ($status === 'deleted') q('DELETE FROM bugs WHERE id = ?', [(int) arg('id')]);
    else q('UPDATE bugs SET status = ?, note = ? WHERE id = ?', [$status, arg('note', 1000) ?: null, (int) arg('id')]);
    audit('bug.' . $status, 'bug #' . (int) arg('id'));
    out(['ok' => true]);

// --------------------------------------------------------------- moderation
case 'admin_stats':
    // Dashboard: figures of the community and of what waits for the team
    $a = require_staff();
    $week = gmdate('Y-m-d H:i:s', time() - 7 * 86400);
    $count = fn (string $sql, array $args = []) => (int) q($sql, $args)->fetchColumn();
    $top = fn (string $sql) => array_map(fn ($r) => ['ref' => $r['ref'], 'n' => (int) $r['n']], q($sql)->fetchAll());
    $signups = [];
    foreach (q('SELECT SUBSTR(created_at, 1, 10) AS d, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY d', [gmdate('Y-m-d', time() - 13 * 86400)])->fetchAll() as $r) $signups[$r['d']] = (int) $r['n'];
    $days = [];
    for ($i = 13; $i >= 0; $i--) { $d = gmdate('Y-m-d', time() - $i * 86400); $days[] = ['d' => $d, 'n' => $signups[$d] ?? 0]; }
    out([
        'pending' => $count("SELECT COUNT(*) FROM suggestions WHERE status = 'pending'"),
        'users' => $count('SELECT COUNT(*) FROM users'),
        'comments' => $count("SELECT COUNT(*) FROM comments WHERE status = 'visible'"),
        'likes' => $count('SELECT COUNT(*) FROM likes'),
        'bugs' => $count("SELECT COUNT(*) FROM bugs WHERE status = 'open'"),
        'banned' => $count('SELECT COUNT(*) FROM users WHERE banned = 1'),
        'staff' => $count("SELECT COUNT(*) FROM users WHERE role <> 'user'"),
        'week' => [
            'users' => $count('SELECT COUNT(*) FROM users WHERE created_at >= ?', [$week]),
            'comments' => $count("SELECT COUNT(*) FROM comments WHERE status = 'visible' AND created_at >= ?", [$week]),
            'suggestions' => $count('SELECT COUNT(*) FROM suggestions WHERE created_at >= ?', [$week]),
            'bugs' => $count('SELECT COUNT(*) FROM bugs WHERE created_at >= ?', [$week]),
            'active' => $count('SELECT COUNT(*) FROM users WHERE last_seen >= ?', [$week]),
        ],
        'coupons' => $count('SELECT COUNT(*) FROM coupons WHERE active = 1 AND (ends IS NULL OR ends >= ?)', [gmdate('Y-m-d')]),
        'coupon_uses' => $count('SELECT COALESCE(SUM(uses), 0) FROM coupons'),
        'clicks' => $count('SELECT COALESCE(SUM(n), 0) FROM shop_clicks WHERE day >= ?', [gmdate('Y-m-d', time() - 29 * 86400)]),
        'partners' => $count('SELECT COUNT(*) FROM partners WHERE active = 1'),
        'signups' => $days,
        'top_liked' => $top('SELECT ref, COUNT(*) AS n FROM likes GROUP BY ref ORDER BY n DESC LIMIT 5'),
        'top_reviewed' => $top("SELECT ref, COUNT(*) AS n FROM comments WHERE status = 'visible' GROUP BY ref ORDER BY n DESC LIMIT 5"),
        'top_owned' => $top("SELECT ref, COUNT(*) AS n FROM garage WHERE status = 'owned' GROUP BY ref ORDER BY n DESC LIMIT 5"),
        'perms' => perms_of($a),
    ]);

case 'admin_suggestions':
    require_perm('suggestions');
    $status = in_array(arg('status'), ['pending', 'approved', 'rejected'], true) ? arg('status') : 'pending';
    $rows = q('SELECT * FROM suggestions WHERE status = ? ORDER BY id ' . ($status === 'pending' ? 'ASC' : 'DESC') . ' LIMIT 200', [$status])->fetchAll();
    $names = user_names(array_merge(array_column($rows, 'user_id'), array_filter(array_column($rows, 'reviewer_id'))));
    foreach ($rows as &$r) {
        $r['author'] = $names[$r['user_id']]['name'] ?? '?';
        $r['reviewer'] = $r['reviewer_id'] ? ($names[$r['reviewer_id']]['name'] ?? '?') : null;
    }
    out($rows);

case 'moderate_suggestion':
    if (!$post) fail('POST attendu.', 405);
    $m = require_perm('suggestions');
    $decision = arg('decision');
    if (!in_array($decision, ['approved', 'rejected'], true)) fail('Décision inconnue.');
    $id = (int) arg('id');
    $value = arg('value', 255);
    if ($decision === 'approved' && $value !== '') {
        q('UPDATE suggestions SET new_value = ? WHERE id = ?', [$value, $id]);
    }
    q('UPDATE suggestions SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?', [$decision, $m['id'], now(), $id]);
    $s = q('SELECT ref, field, new_value FROM suggestions WHERE id = ?', [$id])->fetch();
    if ($s) audit('suggestion.' . $decision, $s['ref'], $s['field'] . ' = ' . $s['new_value']);
    out(['ok' => true]);

case 'admin_comments':
    require_perm('comments');
    $rows = q("SELECT id, ref, user_id, body, status, created_at, rating FROM comments WHERE status <> 'deleted' ORDER BY id DESC LIMIT 200")->fetchAll();
    $names = user_names(array_column($rows, 'user_id'));
    foreach ($rows as &$r) $r['author'] = $names[$r['user_id']]['name'] ?? '?';
    out($rows);

case 'moderate_comment':
    if (!$post) fail('POST attendu.', 405);
    require_perm('comments');
    $status = arg('status');
    if (!in_array($status, ['visible', 'hidden', 'deleted'], true)) fail('Statut inconnu.');
    q('UPDATE comments SET status = ? WHERE id = ?', [$status, (int) arg('id')]);
    $c = q('SELECT ref FROM comments WHERE id = ?', [(int) arg('id')])->fetch();
    audit('comment.' . $status, ($c['ref'] ?? '') . ' (avis #' . (int) arg('id') . ')');
    out(['ok' => true]);

// ------------------------------------------------------------ members, roles
case 'admin_users':
    require_perm('members');
    $rows = q('SELECT id, email, name, role, verified, banned, perms, admin_note, last_seen, created_at FROM users ORDER BY id DESC LIMIT 1000')->fetchAll();
    $n = fn (string $sql) => array_map('intval', array_column(q($sql)->fetchAll(), 'n', 'user_id'));
    $comments = $n("SELECT user_id, COUNT(*) AS n FROM comments WHERE status = 'visible' GROUP BY user_id");
    $suggs = $n('SELECT user_id, COUNT(*) AS n FROM suggestions GROUP BY user_id');
    out(array_map(fn ($u) => [
        'id' => (int) $u['id'], 'email' => $u['email'], 'name' => $u['name'], 'role' => $u['role'],
        'verified' => (int) $u['verified'], 'banned' => (int) $u['banned'], 'note' => $u['admin_note'] ?? '',
        'last_seen' => $u['last_seen'], 'created_at' => $u['created_at'], 'overrides' => user_overrides($u), 'perms' => perms_of($u),
        'comments' => $comments[$u['id']] ?? 0, 'suggestions' => $suggs[$u['id']] ?? 0,
    ], $rows));

case 'user_update':
    if (!$post) fail('POST attendu.', 405);
    $a = require_staff();
    $t = editable_user($a, (int) arg('id'));
    $who = $t['name'] . ' (#' . $t['id'] . ')';
    if (arg('role') !== '') {
        if (!can($a, 'assign')) fail('Vous n\'avez pas la permission de changer les rôles.', 403);
        $role = roles_all()[arg('role')] ?? fail('Rôle inconnu.');
        if ($role['slug'] === 'admin' && $a['role'] !== 'admin') fail('Seul un administrateur peut nommer un administrateur.', 403);
        check_grant($a, $role['perms']);
        q('UPDATE users SET role = ? WHERE id = ?', [$role['slug'], $t['id']]);
        audit('user.role', $who, $t['role'] . ' → ' . $role['slug']);
    }
    if (array_key_exists('grant', body()) || array_key_exists('deny', body())) {
        if (!can($a, 'assign')) fail('Vous n\'avez pas la permission de changer les permissions.', 403);
        $list = fn ($k) => array_values(array_intersect(is_array(body()[$k] ?? null) ? body()[$k] : [], array_keys(PERMS)));
        $grant = $list('grant');
        $deny = array_values(array_diff($list('deny'), $grant));
        check_grant($a, array_merge($grant, $deny));
        q('UPDATE users SET perms = ? WHERE id = ?', [$grant || $deny ? json_encode(['grant' => $grant, 'deny' => $deny]) : null, $t['id']]);
        audit('user.perms', $who, ($grant ? '+' . implode(' +', $grant) : '') . ($deny ? ' -' . implode(' -', $deny) : '') ?: 'selon le rôle');
    }
    if (arg('banned') !== '') {
        if (!can($a, 'ban')) fail('Vous n\'avez pas la permission de suspendre des membres.', 403);
        q('UPDATE users SET banned = ? WHERE id = ?', [arg('banned') === '1' ? 1 : 0, $t['id']]);
        audit(arg('banned') === '1' ? 'user.banned' : 'user.unbanned', $who);
    }
    if (arg('verified') === '1') {
        if (!can($a, 'ban')) fail('Vous n\'avez pas la permission de faire cela.', 403);
        q('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?', [$t['id']]);
        audit('user.verified', $who);
    }
    if (array_key_exists('note', body())) {
        q('UPDATE users SET admin_note = ? WHERE id = ?', [arg('note', 2000) ?: null, $t['id']]);
        audit('user.note', $who);
    }
    out(['ok' => true]);

case 'admin_roles':
    require_staff();
    $counts = array_map('intval', array_column(q('SELECT role, COUNT(*) AS n FROM users GROUP BY role')->fetchAll(), 'n', 'role'));
    out(['perms' => PERMS, 'system' => SYSTEM_ROLES, 'roles' => array_values(array_map(fn ($r) => $r + ['members' => $counts[$r['slug']] ?? 0], roles_all()))]);

case 'role_save':
    if (!$post) fail('POST attendu.', 405);
    $a = require_perm('roles');
    $label = arg('label', 40);
    if (mb_strlen($label) < 2) fail('Donnez un nom au rôle.');
    $color = preg_match('/^#[0-9a-f]{6}$/i', arg('color')) ? arg('color') : null;
    $perms = array_values(array_intersect(is_array(body()['perms'] ?? null) ? body()['perms'] : [], array_keys(PERMS)));
    $slug = arg('slug', 12);
    $old = $slug !== '' ? (roles_all()[$slug] ?? fail('Rôle introuvable.', 404)) : null;
    if ($old && $old['slug'] === 'admin' && $a['role'] !== 'admin') fail('Seul un administrateur peut modifier ce rôle.', 403);
    if ($old && in_array($old['slug'], SYSTEM_ROLES, true)) $perms = $old['perms'];  // fixed: members have none, administrators all
    else check_grant($a, $perms);
    if ($old && $old['slug'] !== 'admin' && $a['role'] !== 'admin') check_grant($a, $old['perms']);
    if ($old) {
        q('UPDATE roles SET label = ?, color = ?, perms = ? WHERE slug = ?', [$label, $color, json_encode($perms), $old['slug']]);
        audit('role.updated', $label, implode(', ', $perms) ?: 'aucune permission');
    } else {
        // Short identifier from the name: "Rédaction" -> "redaction", made unique
        $base = substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((function_exists('iconv') ? @iconv('UTF-8', 'ASCII//TRANSLIT', $label) : '') ?: $label)), '-'), 0, 10) ?: 'role';
        $slug = $base;
        for ($i = 2; isset(roles_all()[$slug]); $i++) $slug = substr($base, 0, 10 - strlen((string) $i)) . $i;
        q('INSERT INTO roles (slug, label, color, perms, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [$slug, $label, $color, json_encode($perms), 50, now()]);
        audit('role.created', $label, implode(', ', $perms) ?: 'aucune permission');
    }
    out(['ok' => true, 'slug' => $slug]);

case 'role_delete':
    if (!$post) fail('POST attendu.', 405);
    $a = require_perm('roles');
    $r = roles_all()[arg('slug', 12)] ?? fail('Rôle introuvable.', 404);
    if (in_array($r['slug'], SYSTEM_ROLES, true)) fail('Ce rôle ne peut pas être supprimé.');
    check_grant($a, $r['perms']);
    $n = (int) q('SELECT COUNT(*) FROM users WHERE role = ?', [$r['slug']])->fetchColumn();
    q("UPDATE users SET role = 'user' WHERE role = ?", [$r['slug']]);
    q('DELETE FROM roles WHERE slug = ?', [$r['slug']]);
    audit('role.deleted', $r['label'], $n ? "$n membre(s) repassé(s) en Membre" : '');
    out(['ok' => true]);

// ------------------------------------------------------------ promo codes
case 'coupon_use':
    // A visitor copied a code: counted for the team (one count per visitor and code per hour)
    if (!$post) fail('POST attendu.', 405);
    $id = (int) arg('id');
    if (!q('SELECT 1 FROM throttle WHERE kind = ? AND k = ? AND at > ?', ['coupon', "$id|" . client_ip(), gmdate('Y-m-d H:i:s', time() - 3600)])->fetchColumn()) {
        throttle('coupon', "$id|" . client_ip(), 1, 60);
        q('UPDATE coupons SET uses = uses + 1 WHERE id = ? AND active = 1', [$id]);
    }
    out(['ok' => true]);

case 'admin_coupons':
    require_perm('coupons');
    $rows = q('SELECT * FROM coupons ORDER BY active DESC, id DESC')->fetchAll();
    foreach ($rows as &$c) $c['state'] = coupon_state($c);
    out($rows);

case 'coupon_save':
    if (!$post) fail('POST attendu.', 405);
    $a = require_perm('coupons');
    $code = strtoupper(preg_replace('/\s+/', '', arg('code', 40)));
    if (!preg_match('/^[A-Z0-9_\-]{2,40}$/', $code)) fail('Code invalide : lettres, chiffres, - et _ uniquement.');
    $shop = arg('shop', 60);
    if ($shop === '') fail('Indiquez la boutique où le code fonctionne.');
    $date = function (string $k) { $v = arg($k, 10); if ($v !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) fail('Date invalide.'); return $v ?: null; };
    [$starts, $ends] = [$date('starts'), $date('ends')];
    if ($starts && $ends && $ends < $starts) fail('La date de fin est avant la date de début.');
    $url = arg('url', 500) !== '' ? clean_url(arg('url', 500)) : null;
    $vals = [$code, $shop, arg('discount', 30) ?: null, arg('title', 160) ?: null, $url, arg('brand', 60) ?: null, $starts, $ends, arg('active') === '0' ? 0 : 1];
    if ((int) arg('id')) {
        q('UPDATE coupons SET code = ?, shop = ?, discount = ?, title = ?, url = ?, brand = ?, starts = ?, ends = ?, active = ? WHERE id = ?', [...$vals, (int) arg('id')]);
        audit('coupon.updated', "$code ($shop)");
    } else {
        q('INSERT INTO coupons (code, shop, discount, title, url, brand, starts, ends, active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...$vals, $a['id'], now()]);
        audit('coupon.created', "$code ($shop)", (string) arg('discount', 30));
    }
    out(['ok' => true]);

case 'coupon_delete':
    if (!$post) fail('POST attendu.', 405);
    require_perm('coupons');
    $c = q('SELECT code, shop FROM coupons WHERE id = ?', [(int) arg('id')])->fetch();
    q('DELETE FROM coupons WHERE id = ?', [(int) arg('id')]);
    if ($c) audit('coupon.deleted', "{$c['code']} ({$c['shop']})");
    out(['ok' => true]);

// ------------------------------------------------------------ partner shops (affiliate links), clicks
case 'click':
    // A visitor opened a shop: counted per shop and per day only (no visitor data kept), once per visitor and shop every 10 minutes
    if (!$post) fail('POST attendu.', 405);
    $shop = arg('shop', 60);
    if ($shop === '' || preg_match('/[<>"]/', $shop)) out(['ok' => false]);
    $key = $shop . '|' . client_ip();
    if (!q('SELECT 1 FROM throttle WHERE kind = ? AND k = ? AND at > ?', ['click', $key, gmdate('Y-m-d H:i:s', time() - 600)])->fetchColumn()) {
        throttle('click', $key, 1, 10);
        $day = gmdate('Y-m-d');
        if (!q('UPDATE shop_clicks SET n = n + 1 WHERE shop = ? AND day = ?', [$shop, $day])->rowCount()) {
            try { q('INSERT INTO shop_clicks (shop, day, n) VALUES (?, ?, 1)', [$shop, $day]); }
            catch (PDOException $e) { q('UPDATE shop_clicks SET n = n + 1 WHERE shop = ? AND day = ?', [$shop, $day]); }
        }
    }
    out(['ok' => true]);

case 'admin_partners':
    require_perm('partners');
    $since = fn (int $days) => gmdate('Y-m-d', time() - ($days - 1) * 86400);
    $sum = function (string $since) { $o = []; foreach (q('SELECT shop, SUM(n) AS n FROM shop_clicks WHERE day >= ? GROUP BY shop', [$since])->fetchAll() as $r) $o[$r['shop']] = (int) $r['n']; return $o; };
    [$d7, $d30, $all] = [$sum($since(7)), $sum($since(30)), $sum('0000-00-00')];
    $partners = q('SELECT * FROM partners ORDER BY active DESC, shop')->fetchAll();
    foreach ($partners as &$p) $p += ['c7' => $d7[$p['shop']] ?? 0, 'c30' => $d30[$p['shop']] ?? 0, 'call' => $all[$p['shop']] ?? 0];
    arsort($d30);
    $days = [];
    foreach (q('SELECT day, SUM(n) AS n FROM shop_clicks WHERE day >= ? GROUP BY day', [$since(30)])->fetchAll() as $r) $days[$r['day']] = (int) $r['n'];
    $series = [];
    for ($i = 29; $i >= 0; $i--) { $d = gmdate('Y-m-d', time() - $i * 86400); $series[] = ['d' => $d, 'n' => $days[$d] ?? 0]; }
    out(['partners' => $partners, 'shops' => array_map(fn ($s, $n) => ['shop' => $s, 'n' => $n, 'c7' => $d7[$s] ?? 0], array_keys($d30), $d30), 'days' => $series]);

case 'partner_save':
    if (!$post) fail('POST attendu.', 405);
    require_perm('partners');
    $shop = arg('shop', 60);
    if ($shop === '') fail('Indiquez la boutique.');
    $domain = strtolower(preg_replace('~^(https?://)?(www\.)?([^/]+).*$~i', '$3', arg('domain', 120)));
    if ($domain !== '' && !preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain)) fail('Domaine invalide (exemple : drone-fpv-racer.com).');
    // Either parameters added to the shop's links (ref=multimotors), or a network link containing {url} (Awin, Effiliation…)
    $link = ltrim(arg('link', 500), '?&');
    if (str_contains($link, '{url}')) {
        if (!preg_match('~^https://[^\s"<>]+$~', $link)) fail('Le lien d\'affiliation doit commencer par https:// et contenir {url}.');
    } elseif (!preg_match('/^[A-Za-z0-9_.~-]+=[^\s&"<>]*(&[A-Za-z0-9_.~-]+=[^\s&"<>]*)*$/', $link)) {
        fail('Indiquez le paramètre d\'affiliation (exemple : ref=multimotors) ou un lien contenant {url}.');
    }
    $vals = [$shop, $domain ?: null, $link, arg('note', 2000) ?: null, arg('active') === '0' ? 0 : 1];
    if ((int) arg('id')) {
        q('UPDATE partners SET shop = ?, domain = ?, link = ?, note = ?, active = ? WHERE id = ?', [...$vals, (int) arg('id')]);
        audit('partner.updated', $shop);
    } else {
        q('INSERT INTO partners (shop, domain, link, note, active, created_at) VALUES (?, ?, ?, ?, ?, ?)', [...$vals, now()]);
        audit('partner.created', $shop);
    }
    out(['ok' => true]);

case 'partner_delete':
    if (!$post) fail('POST attendu.', 405);
    require_perm('partners');
    $p = q('SELECT shop FROM partners WHERE id = ?', [(int) arg('id')])->fetch();
    q('DELETE FROM partners WHERE id = ?', [(int) arg('id')]);
    if ($p) audit('partner.deleted', $p['shop']);
    out(['ok' => true]);

// ------------------------------------------------------------ settings, log
case 'admin_settings':
    require_perm('settings');
    out(['announce_on' => setting('announce_on'), 'announce_text' => setting('announce_text'), 'announce_link' => setting('announce_link'),
        'announce_kind' => setting('announce_kind', 'info'), 'registrations' => setting('registrations', '1'), 'comments' => setting('comments', '1')]);

case 'settings_save':
    if (!$post) fail('POST attendu.', 405);
    require_perm('settings');
    $vals = [
        'announce_on' => arg('announce_on') === '1' ? '1' : '0', 'announce_text' => arg('announce_text', 300),
        'announce_link' => arg('announce_link', 500) !== '' ? (str_starts_with(arg('announce_link', 500), '#') ? arg('announce_link', 500) : clean_url(arg('announce_link', 500))) : '',
        'announce_kind' => in_array(arg('announce_kind'), ['info', 'promo', 'warning'], true) ? arg('announce_kind') : 'info',
        'registrations' => arg('registrations') === '0' ? '0' : '1', 'comments' => arg('comments') === '0' ? '0' : '1',
    ];
    if ($vals['announce_on'] === '1' && $vals['announce_text'] === '') fail('Écrivez le texte du bandeau.');
    $changed = [];
    foreach ($vals as $k => $v) {
        if (setting($k, in_array($k, ['registrations', 'comments'], true) ? '1' : '') === $v) continue;
        $changed[] = $k;
        q('DELETE FROM settings WHERE k = ?', [$k]);
        q('INSERT INTO settings (k, v) VALUES (?, ?)', [$k, $v]);
    }
    if ($changed) audit('settings', implode(', ', $changed));
    out(['ok' => true, 'message' => $changed ? 'Réglages enregistrés.' : 'Rien à modifier.']);

case 'search_status':
    require_perm('settings');
    out(gh_last_runs() + ['configured' => (string) cfg('github_token', '') !== '']);

case 'search_run':
    if (!$post) fail('POST attendu.', 405);
    require_perm('settings');
    throttle('search_run', 'site', 3, 60);
    [$ok, $msg] = gh_start_search(false);
    if (!$ok) fail($msg, 502);
    audit('search.run', 'recherche quotidienne');
    out(['ok' => true, 'message' => 'Recherche lancée : elle prend environ une heure, le site est mis à jour à la fin.']);

case 'admin_log':
    require_perm('logs');
    $kind = preg_replace('/[^a-z]/', '', arg('kind', 20));
    $rows = q('SELECT id, user_id, action, target, detail, created_at FROM admin_log' . ($kind ? ' WHERE action LIKE ?' : '') . ' ORDER BY id DESC LIMIT 400', $kind ? [$kind . '%'] : [])->fetchAll();
    $names = user_names(array_filter(array_column($rows, 'user_id')));
    foreach ($rows as &$r) $r['who'] = $r['user_id'] ? ($names[$r['user_id']]['name'] ?? 'ancien membre') : 'système';
    out($rows);

// --------------------------------------------------------------- news
case 'news_save':
    if (!$post) fail('POST attendu.', 405);
    $a = require_perm('news');
    $title = arg('title', 160);
    $text = arg('body', 5000);
    if ($title === '' || $text === '') fail('Titre et texte obligatoires.');
    $published = arg('published') === '0' ? 0 : 1;
    if ((int) arg('id')) {
        q('UPDATE news SET title = ?, body = ?, published = ? WHERE id = ?', [$title, $text, $published, (int) arg('id')]);
        audit('news.updated', $title);
    } else {
        q('INSERT INTO news (title, body, author_id, published, created_at) VALUES (?, ?, ?, ?, ?)', [$title, $text, $a['id'], $published, now()]);
        audit('news.created', $title);
    }
    out(['ok' => true]);

case 'news_delete':
    if (!$post) fail('POST attendu.', 405);
    require_perm('news');
    $n = q('SELECT title FROM news WHERE id = ?', [(int) arg('id')])->fetch();
    q('DELETE FROM news WHERE id = ?', [(int) arg('id')]);
    if ($n) audit('news.deleted', $n['title']);
    out(['ok' => true]);

case 'admin_news':
    require_perm('news');
    out(q('SELECT id, title, body, published, created_at FROM news ORDER BY id DESC LIMIT 100')->fetchAll());

// ------------------------------------------------------------ daily job
case 'export':
    // Read by the daily GitHub job to fold approved changes into the catalogue
    if (!hash_equals((string) cfg('export_key', ''), arg('key', 200)) || cfg('export_key', '') === 'change-me') fail('Clé invalide.', 403);
    out(q("SELECT ref, field, new_value, source, reviewed_at FROM suggestions WHERE status = 'approved' AND field <> 'AUTRE' ORDER BY reviewed_at, id")->fetchAll());

default:
    fail('Action inconnue.', 404);
}
