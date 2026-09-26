<?php
// Multi-Motors community API: accounts, likes, comments, change suggestions,
// moderation and site news. One endpoint: api/index.php?action=<name>
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/schema.php';

const FIELDS = ['NOM', 'VERSION', 'CLASSE', 'KV', 'POIDS', 'D MOTEUR', 'H MOTEUR', 'D SHAFT', 'L SHAFT', 'TYPE SHAFT',
    'VIS HEL', 'VIS FIX', 'ENTRAXE FIX', 'LIPO', 'L CABLE', 'TYPE CABLE', 'HELICE', 'PUISSANCE', 'AMP', 'AIMANT',
    'CLOCHE', 'CONFIG', 'RESISTANCE', 'UTILISATION', 'LIEN', 'IMG', 'AUTRE'];
const ROLES = ['user', 'moderator', 'admin'];

if (!is_file(__DIR__ . '/config.php')) fail('Le serveur n\'est pas encore configuré.', 503);

$action = $_GET['action'] ?? '';
$post = $_SERVER['REQUEST_METHOD'] === 'POST';

// Writes must come from the site itself: a custom header cannot be sent by
// another website without a CORS preflight, which we never allow.
if ($post && ($_SERVER['HTTP_X_MM'] ?? '') !== '1') fail('Requête refusée.', 403);

try {
    db()->query('SELECT 1 FROM users LIMIT 1');
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
    $rows = q('SELECT id, name, role FROM users WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids)->fetchAll();
    return array_column($rows, null, 'id');
}

switch ($action) {

// ---------------------------------------------------------------- accounts
case 'me':
    out(['user' => public_user(current_user()), 'google_client_id' => cfg('google_client_id', '')]);

case 'register':
    if (!$post) fail('POST attendu.', 405);
    throttle('register', client_ip(), 5, 60);
    $email = mb_strtolower(arg('email', 190));
    $name = arg('name', 40);
    $pass = (string) (body()['password'] ?? '');
    if (!valid_email($email)) fail('Adresse email invalide.');
    if (mb_strlen($name) < 2) fail('Choisissez un pseudo d\'au moins 2 caractères.');
    if (strlen($pass) < 8) fail('Le mot de passe doit faire au moins 8 caractères.');
    if (q('SELECT id FROM users WHERE email = ?', [$email])->fetch()) fail('Un compte existe déjà avec cette adresse.');
    $tok = token();
    $role = $email === mb_strtolower((string) cfg('admin_email', '')) ? 'admin' : 'user';
    q('INSERT INTO users (email, name, pass_hash, role, verified, verify_token, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [$email, $name, password_hash($pass, PASSWORD_DEFAULT), $role, $tok, now()]);
    $link = rtrim((string) cfg('site_url'), '/') . '/api/index.php?action=verify&token=' . $tok;
    send_mail($email, 'Confirmez votre compte Multi-Motors',
        "Bonjour $name,\n\nConfirmez votre adresse pour activer votre compte :\n$link\n\nÀ bientôt sur Multi-Motors.");
    login_as((int) db()->lastInsertId());
    out(['user' => public_user(current_user()), 'message' => 'Compte créé. Un lien de confirmation vous a été envoyé par email.']);

case 'verify':
    $tok = arg('token', 64);
    $u = $tok ? q('SELECT id FROM users WHERE verify_token = ?', [$tok])->fetch() : null;
    if ($u) {
        q('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?', [$u['id']]);
        login_as((int) $u['id']);
    }
    header('Location: ' . rtrim((string) cfg('site_url'), '/') . '/#' . ($u ? 'compte-confirme' : 'lien-invalide'));
    exit;

case 'login':
    if (!$post) fail('POST attendu.', 405);
    $email = mb_strtolower(arg('email', 190));
    throttle('login', client_ip() . '|' . $email, 8, 15);
    $u = q('SELECT id, pass_hash, banned FROM users WHERE email = ?', [$email])->fetch();
    if (!$u || !$u['pass_hash'] || !password_verify((string) (body()['password'] ?? ''), $u['pass_hash'])) fail('Email ou mot de passe incorrect.', 401);
    if ($u['banned']) fail('Ce compte a été suspendu.', 403);
    login_as((int) $u['id']);
    out(['user' => public_user(current_user())]);

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
        $role = $email === mb_strtolower((string) cfg('admin_email', '')) ? 'admin' : 'user';
        $name = mb_substr($info['given_name'] ?? $info['name'] ?? explode('@', $email)[0], 0, 40);
        q('INSERT INTO users (email, name, google_sub, role, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)', [$email, $name, $info['sub'], $role, now()]);
        $id = (int) db()->lastInsertId();
    }
    login_as($id);
    out(['user' => public_user(current_user())]);

case 'forgot':
    if (!$post) fail('POST attendu.', 405);
    $email = mb_strtolower(arg('email', 190));
    throttle('forgot', client_ip(), 5, 60);
    $u = q('SELECT id, name FROM users WHERE email = ?', [$email])->fetch();
    if ($u) {
        $tok = token();
        q('UPDATE users SET reset_token = ?, reset_until = ? WHERE id = ?', [$tok, gmdate('Y-m-d H:i:s', time() + 3600), $u['id']]);
        send_mail($email, 'Nouveau mot de passe Multi-Motors',
            "Bonjour {$u['name']},\n\nPour choisir un nouveau mot de passe (lien valable 1 heure) :\n" .
            rtrim((string) cfg('site_url'), '/') . "/#reset/$tok\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.");
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
    out(['user' => public_user(current_user()), 'message' => 'Mot de passe modifié.']);

// ------------------------------------------------------------ public reads
case 'motor':
    // Everything the motor page needs in one call
    $ref = ref_arg();
    $me = current_user();
    $likes = (int) q('SELECT COUNT(*) FROM likes WHERE ref = ?', [$ref])->fetchColumn();
    $liked = $me ? (bool) q('SELECT 1 FROM likes WHERE ref = ? AND user_id = ?', [$ref, $me['id']])->fetchColumn() : false;
    $mod = $me && in_array($me['role'], ['moderator', 'admin'], true);
    $rows = q('SELECT id, user_id, body, status, created_at FROM comments WHERE ref = ?' . ($mod ? " AND status <> 'deleted'" : " AND status = 'visible'") . ' ORDER BY id DESC LIMIT 200', [$ref])->fetchAll();
    $names = user_names(array_column($rows, 'user_id'));
    $comments = array_map(fn ($c) => [
        'id' => (int) $c['id'], 'body' => $c['body'], 'status' => $c['status'], 'at' => $c['created_at'],
        'author' => $names[$c['user_id']]['name'] ?? 'Membre', 'role' => $names[$c['user_id']]['role'] ?? 'user',
        'mine' => $me && (int) $c['user_id'] === (int) $me['id'],
    ], $rows);
    $pending = (int) q("SELECT COUNT(*) FROM suggestions WHERE ref = ? AND status = 'pending'", [$ref])->fetchColumn();
    out(['likes' => $likes, 'liked' => $liked, 'comments' => $comments, 'pending_suggestions' => $pending]);

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
    if (mb_strlen($text) < 3) fail('Votre commentaire est vide.');
    throttle('comment', (string) $u['id'], 5, 10);
    q('INSERT INTO comments (ref, user_id, body, status, created_at) VALUES (?, ?, ?, ?, ?)', [$ref, $u['id'], $text, 'visible', now()]);
    out(['ok' => true]);

case 'comment_delete':
    if (!$post) fail('POST attendu.', 405);
    $u = require_user();
    $c = q('SELECT user_id FROM comments WHERE id = ?', [(int) arg('id')])->fetch();
    if (!$c) fail('Commentaire introuvable.', 404);
    if ((int) $c['user_id'] !== (int) $u['id'] && !in_array($u['role'], ['moderator', 'admin'], true)) fail('Action non autorisée.', 403);
    q("UPDATE comments SET status = 'deleted' WHERE id = ?", [(int) arg('id')]);
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

// --------------------------------------------------------------- moderation
case 'admin_stats':
    require_role('moderator', 'admin');
    out([
        'pending' => (int) q("SELECT COUNT(*) FROM suggestions WHERE status = 'pending'")->fetchColumn(),
        'users' => (int) q('SELECT COUNT(*) FROM users')->fetchColumn(),
        'comments' => (int) q("SELECT COUNT(*) FROM comments WHERE status = 'visible'")->fetchColumn(),
        'likes' => (int) q('SELECT COUNT(*) FROM likes')->fetchColumn(),
    ]);

case 'admin_suggestions':
    require_role('moderator', 'admin');
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
    $m = require_role('moderator', 'admin');
    $decision = arg('decision');
    if (!in_array($decision, ['approved', 'rejected'], true)) fail('Décision inconnue.');
    $id = (int) arg('id');
    $value = arg('value', 255);
    if ($decision === 'approved' && $value !== '') {
        q('UPDATE suggestions SET new_value = ? WHERE id = ?', [$value, $id]);
    }
    q('UPDATE suggestions SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?', [$decision, $m['id'], now(), $id]);
    out(['ok' => true]);

case 'admin_comments':
    require_role('moderator', 'admin');
    $rows = q("SELECT id, ref, user_id, body, status, created_at FROM comments WHERE status <> 'deleted' ORDER BY id DESC LIMIT 200")->fetchAll();
    $names = user_names(array_column($rows, 'user_id'));
    foreach ($rows as &$r) $r['author'] = $names[$r['user_id']]['name'] ?? '?';
    out($rows);

case 'moderate_comment':
    if (!$post) fail('POST attendu.', 405);
    require_role('moderator', 'admin');
    $status = arg('status');
    if (!in_array($status, ['visible', 'hidden', 'deleted'], true)) fail('Statut inconnu.');
    q('UPDATE comments SET status = ? WHERE id = ?', [$status, (int) arg('id')]);
    out(['ok' => true]);

case 'admin_users':
    require_role('moderator', 'admin');
    out(q('SELECT id, email, name, role, verified, banned, created_at FROM users ORDER BY id DESC LIMIT 500')->fetchAll());

case 'user_update':
    if (!$post) fail('POST attendu.', 405);
    $a = require_role('admin');
    $id = (int) arg('id');
    if ($id === (int) $a['id']) fail('Vous ne pouvez pas modifier votre propre compte ici.');
    if (arg('role') !== '') {
        if (!in_array(arg('role'), ROLES, true)) fail('Rôle inconnu.');
        q('UPDATE users SET role = ? WHERE id = ?', [arg('role'), $id]);
    }
    if (arg('banned') !== '') q('UPDATE users SET banned = ? WHERE id = ?', [arg('banned') === '1' ? 1 : 0, $id]);
    out(['ok' => true]);

case 'news_save':
    if (!$post) fail('POST attendu.', 405);
    $a = require_role('moderator', 'admin');
    $title = arg('title', 160);
    $text = arg('body', 5000);
    if ($title === '' || $text === '') fail('Titre et texte obligatoires.');
    $published = arg('published') === '0' ? 0 : 1;
    if ((int) arg('id')) {
        q('UPDATE news SET title = ?, body = ?, published = ? WHERE id = ?', [$title, $text, $published, (int) arg('id')]);
    } else {
        q('INSERT INTO news (title, body, author_id, published, created_at) VALUES (?, ?, ?, ?, ?)', [$title, $text, $a['id'], $published, now()]);
    }
    out(['ok' => true]);

case 'news_delete':
    if (!$post) fail('POST attendu.', 405);
    require_role('moderator', 'admin');
    q('DELETE FROM news WHERE id = ?', [(int) arg('id')]);
    out(['ok' => true]);

case 'admin_news':
    require_role('moderator', 'admin');
    out(q('SELECT id, title, body, published, created_at FROM news ORDER BY id DESC LIMIT 100')->fetchAll());

// ------------------------------------------------------------ daily job
case 'export':
    // Read by the daily GitHub job to fold approved changes into the catalogue
    if (!hash_equals((string) cfg('export_key', ''), arg('key', 200)) || cfg('export_key', '') === 'change-me') fail('Clé invalide.', 403);
    out(q("SELECT ref, field, new_value, source, reviewed_at FROM suggestions WHERE status = 'approved' AND field <> 'AUTRE' ORDER BY reviewed_at, id")->fetchAll());

default:
    fail('Action inconnue.', 404);
}
