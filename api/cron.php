<?php
// Daily search started by the OVH scheduled task (Hébergement > Tâches planifiées - Cron :
// script "www/api/cron.php", every day at the chosen hour). GitHub's own schedule starts it hours
// late; this starts it on time. Also callable as https://multi-motors.fr/api/cron.php?key=<cron_key>
// (or export_key when cron_key is not set): to test it, or from an online cron service (cron-job.org…)
// when the hosting has no scheduled tasks. If the search already succeeded today, the workflow stops at once.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/github.php';

$cli = PHP_SAPI === 'cli';
if (!$cli) {
    header('Content-Type: text/plain; charset=utf-8');
    // A key of its own for the online cron services, so the export key never leaves the site
    $key = (string) (cfg('cron_key', '') ?: cfg('export_key', ''));
    if ($key === '' || $key === 'change-me' || !hash_equals($key, (string) ($_GET['key'] ?? ''))) {
        http_response_code(403);
        exit("Accès refusé.\n");
    }
}
[$ok, $msg] = gh_start_search(true);
echo gmdate('Y-m-d H:i:s') . " UTC - $msg\n";
exit($ok ? 0 : 1);
