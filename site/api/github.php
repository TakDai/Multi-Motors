<?php
// Starting the daily search (GitHub Actions) from the site: OVH scheduled task (api/cron.php)
// and the "run now" button of the administration. Needs 'github_token' in api/config.php:
// a fine-grained GitHub token limited to this repository, permission "Actions: read and write".
declare(strict_types=1);

const GH_REPO = 'TakDai/Multi-Motors';
const GH_WORKFLOW = 'nouveaux-moteurs.yml';
const GH_BRANCH = 'Moteurs';

function gh_call(string $method, string $path, ?array $body = null): array {
    $token = (string) cfg('github_token', '');
    if ($token === '') return [0, ['message' => "Jeton GitHub absent : ajoutez 'github_token' dans api/config.php."]];
    $ch = curl_init('https://api.github.com/repos/' . GH_REPO . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28',
                               'User-Agent: multi-motors.fr', 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $out = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode((string) $out, true) ?: []];
}

// auto = true: the workflow does nothing if a search already succeeded today (a second cron, a retry)
function gh_start_search(bool $auto): array {
    [$code, $res] = gh_call('POST', '/actions/workflows/' . GH_WORKFLOW . '/dispatches', ['ref' => GH_BRANCH, 'inputs' => ['auto' => $auto ? 'true' : 'false']]);
    if ($code === 204) return [true, 'Recherche lancée.'];
    return [false, $code === 0 ? ($res['message'] ?? 'GitHub ne répond pas.') : 'GitHub a refusé le lancement (' . $code . ') : ' . ($res['message'] ?? 'réponse inattendue')];
}

function gh_last_runs(int $n = 6): array {
    [$code, $res] = gh_call('GET', '/actions/workflows/' . GH_WORKFLOW . '/runs?per_page=' . $n);
    if ($code !== 200) return ['error' => $code === 0 ? ($res['message'] ?? 'GitHub ne répond pas.') : 'Impossible de lire les exécutions (' . $code . ') : ' . ($res['message'] ?? '')];
    return ['runs' => array_map(fn ($r) => ['id' => $r['id'], 'event' => $r['event'], 'status' => $r['status'], 'conclusion' => $r['conclusion'],
        'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'], 'url' => $r['html_url']], $res['workflow_runs'] ?? [])];
}
