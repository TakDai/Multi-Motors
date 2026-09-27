<?php
// Entry point of the Multi-Motors API. Written for any PHP version so that it can
// always explain what is wrong (old PHP, broken api/config.php, fatal error)
// instead of an empty error page. The API itself is in app.php (PHP 8.1+).

function mm_boot_fail($msg) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(array('error' => $msg));
    exit;
}

if (PHP_VERSION_ID < 80100) {
    mm_boot_fail('PHP ' . PHP_VERSION . ' est trop ancien pour le site : il faut PHP 8.1 ou plus. '
        . 'Vérifiez le fichier .ovhconfig du dossier du site (app.engine.version=8.2) ou la version PHP de l\'hébergement dans l\'espace client OVH.');
}

// A fatal error anywhere: its kind and line, never the content of the configuration
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], array(E_ERROR, E_PARSE, E_COMPILE_ERROR, E_CORE_ERROR), true)) {
        $where = basename($e['file']) . ' ligne ' . $e['line'];
        if (basename($e['file']) === 'config.php') {
            mm_boot_fail("Erreur dans api/config.php ($where) : vérifiez les guillemets simples ' ' autour de chaque valeur et la virgule en fin de ligne.");
        }
        mm_boot_fail("Erreur du serveur ($where).");
    }
});

$config = __DIR__ . '/config.php';
if (is_file($config)) {
    try {
        $c = require $config;
    } catch (Throwable $t) {
        mm_boot_fail('Erreur dans api/config.php (ligne ' . $t->getLine() . ') : vérifiez les guillemets simples \' \' autour de chaque valeur et la virgule en fin de ligne.');
    }
    if (!is_array($c)) mm_boot_fail('api/config.php doit se terminer par un tableau « return [ … ]; » (voir config.sample.php).');
}

require __DIR__ . '/app.php';
