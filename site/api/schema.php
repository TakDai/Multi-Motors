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
        "CREATE TABLE IF NOT EXISTS throttle (
            kind VARCHAR(20) NOT NULL, k VARCHAR(190) NOT NULL, at VARCHAR(19) NOT NULL)$engine",
    ];
    foreach ($sql as $s) db()->exec($s);
    foreach (['CREATE INDEX idx_comments_ref ON comments (ref)', 'CREATE INDEX idx_sugg_status ON suggestions (status)',
              'CREATE INDEX idx_likes_ref ON likes (ref)', 'CREATE INDEX idx_throttle ON throttle (kind, k)'] as $s) {
        try { db()->exec($s); } catch (PDOException $e) { /* index already there */ }
    }
}
