<?php
// Tables of the community features. Run once through ?action=install (admin
// key required) or automatically when the tables are missing.
function install_schema(): void {
    $id = is_sqlite() ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $engine = is_sqlite() ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    $text = is_sqlite() ? 'TEXT' : 'MEDIUMTEXT';
    $sql = [
        "CREATE TABLE IF NOT EXISTS users (
            id $id, email VARCHAR(190) NOT NULL UNIQUE, name VARCHAR(60) NOT NULL,
            pass_hash VARCHAR(255) NULL, google_sub VARCHAR(64) NULL,
            role VARCHAR(12) NOT NULL DEFAULT 'user', verified TINYINT NOT NULL DEFAULT 0, banned TINYINT NOT NULL DEFAULT 0,
            verify_token VARCHAR(64) NULL, reset_token VARCHAR(64) NULL, reset_until VARCHAR(19) NULL,
            created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS likes (
            user_id INT NOT NULL, ref VARCHAR(64) NOT NULL, created_at VARCHAR(19) NOT NULL,
            PRIMARY KEY (user_id, ref))$engine",
        "CREATE TABLE IF NOT EXISTS comments (
            id $id, ref VARCHAR(64) NOT NULL, user_id INT NOT NULL, body TEXT NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'visible', created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS suggestions (
            id $id, ref VARCHAR(64) NOT NULL, user_id INT NOT NULL, field VARCHAR(30) NOT NULL,
            old_value VARCHAR(255) NULL, new_value VARCHAR(255) NOT NULL, source VARCHAR(500) NULL, note TEXT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'pending', reviewer_id INT NULL, reviewed_at VARCHAR(19) NULL,
            created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS news (
            id $id, title VARCHAR(160) NOT NULL, body TEXT NOT NULL, author_id INT NOT NULL,
            published TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS profiles (
            user_id INT NOT NULL PRIMARY KEY, bio TEXT NULL, location VARCHAR(80) NULL, website VARCHAR(200) NULL,
            youtube VARCHAR(200) NULL, instagram VARCHAR(200) NULL, color VARCHAR(7) NULL, avatar $text NULL,
            avatar_v INT NOT NULL DEFAULT 0, setup TEXT NULL, flying VARCHAR(30) NULL,
            is_public TINYINT NOT NULL DEFAULT 1, show_likes TINYINT NOT NULL DEFAULT 1, updated_at VARCHAR(19) NULL)$engine",
        "CREATE TABLE IF NOT EXISTS garage (
            user_id INT NOT NULL, ref VARCHAR(64) NOT NULL, status VARCHAR(10) NOT NULL, note VARCHAR(200) NULL,
            created_at VARCHAR(19) NOT NULL, PRIMARY KEY (user_id, ref))$engine",
        "CREATE TABLE IF NOT EXISTS history (
            user_id INT NOT NULL, ref VARCHAR(64) NOT NULL, at VARCHAR(19) NOT NULL, PRIMARY KEY (user_id, ref))$engine",
        "CREATE TABLE IF NOT EXISTS bugs (
            id $id, user_id INT NULL, category VARCHAR(40) NOT NULL, body TEXT NOT NULL, url VARCHAR(500) NULL,
            selector VARCHAR(500) NULL, snippet TEXT NULL, element_text VARCHAR(300) NULL, viewport VARCHAR(30) NULL,
            agent VARCHAR(300) NULL, email VARCHAR(190) NULL, status VARCHAR(12) NOT NULL DEFAULT 'open',
            note TEXT NULL, created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS roles (
            slug VARCHAR(12) NOT NULL PRIMARY KEY, label VARCHAR(40) NOT NULL, color VARCHAR(7) NULL,
            perms TEXT NULL, position INT NOT NULL DEFAULT 50, created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS coupons (
            id $id, code VARCHAR(40) NOT NULL, shop VARCHAR(60) NOT NULL, discount VARCHAR(30) NULL, title VARCHAR(160) NULL,
            url VARCHAR(500) NULL, brand VARCHAR(60) NULL, starts VARCHAR(10) NULL, ends VARCHAR(10) NULL,
            active TINYINT NOT NULL DEFAULT 1, uses INT NOT NULL DEFAULT 0, created_by INT NULL, created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS admin_log (
            id $id, user_id INT NULL, action VARCHAR(40) NOT NULL, target VARCHAR(160) NULL, detail TEXT NULL,
            created_at VARCHAR(19) NOT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS settings (k VARCHAR(40) NOT NULL PRIMARY KEY, v TEXT NULL)$engine",
        "CREATE TABLE IF NOT EXISTS throttle (
            kind VARCHAR(20) NOT NULL, k VARCHAR(190) NOT NULL, at VARCHAR(19) NOT NULL)$engine",
    ];
    foreach ($sql as $s) db()->exec($s);
    // Columns added after the first install: reviews with a rating, strong and weak points
    foreach (['rating TINYINT NULL', 'pros TEXT NULL', 'cons TEXT NULL'] as $col) {
        try { db()->exec("ALTER TABLE comments ADD COLUMN $col"); } catch (PDOException $e) { /* already there */ }
    }
    // Profiles: banner image and the extra pilot details (JSON)
    foreach (["banner $text NULL", 'banner_v INT NOT NULL DEFAULT 0', 'extra TEXT NULL'] as $col) {
        try { db()->exec("ALTER TABLE profiles ADD COLUMN $col"); } catch (PDOException $e) { /* already there */ }
    }
    // Members: permissions given or removed on top of their role (JSON), a private note of the team, last visit
    foreach (['perms TEXT NULL', 'admin_note TEXT NULL', 'last_seen VARCHAR(19) NULL'] as $col) {
        try { db()->exec("ALTER TABLE users ADD COLUMN $col"); } catch (PDOException $e) { /* already there */ }
    }
    // The three historical roles; administrators always have every permission
    if (!(int) db()->query('SELECT COUNT(*) FROM roles')->fetchColumn()) {
        foreach ([['user', 'Membre', '#888888', [], 0], ['moderator', 'Modération', '#3a86ff', ['suggestions', 'comments', 'bugs', 'news', 'members'], 50],
                  ['admin', 'Admin', '#ff5757', [], 100]] as [$slug, $label, $color, $perms, $pos]) {
            q('INSERT INTO roles (slug, label, color, perms, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [$slug, $label, $color, json_encode($perms), $pos, now()]);
        }
    }
    foreach (['CREATE INDEX idx_comments_ref ON comments (ref)', 'CREATE INDEX idx_sugg_status ON suggestions (status)',
              'CREATE INDEX idx_likes_ref ON likes (ref)', 'CREATE INDEX idx_garage_ref ON garage (ref)', 'CREATE INDEX idx_throttle ON throttle (kind, k)', 'CREATE INDEX idx_log_at ON admin_log (created_at)'] as $s) {
        try { db()->exec($s); } catch (PDOException $e) { /* index already there */ }
    }
}
