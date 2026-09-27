<?php
// Copied to config.php at deploy time from the GitHub secrets (see README).
return [
    // MySQL database of the OVH hosting (Web Cloud > Hébergements > Bases de données)
    'db_dsn'  => 'mysql:host=XXXX.mysql.db;dbname=XXXX;charset=utf8mb4',
    'db_user' => 'XXXX',
    'db_pass' => 'XXXX',
    // Account that becomes administrator when it signs up
    'admin_email' => 'toi@example.com',
    // Google sign-in (Google Cloud console > APIs & Services > Credentials > OAuth client ID, type Web)
    'google_client_id' => '',
    // Sender of verification / reset emails (an address of your OVH domain)
    'mail_from' => 'no-reply@example.com',
    // Public address of the site, used in email links
    'site_url' => 'https://example.com/',
    // Secret used by the daily GitHub job to read approved changes
    'export_key' => 'change-me',
];
