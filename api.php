<?php
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const COOKIE_NAME = 'treino_auth';
const COOKIE_DAYS = 90;
const GUARD = "<?php http_response_code(403); exit; ?>\n"; // impede ler o arquivo de dados pelo navegador

$DATA_DIR = __DIR__ . '/data';
$STORE = $DATA_DIR . '/store.php';

/* ---------------- respostas ---------------- */
function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail($msg, $code = 400) { out(['error' => $msg], $code); }

/* ---------------- autenticação (cookie assinado) ---------------- */
function cookie_path() {
    $p = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');
    return $p === '' ? '/' : $p . '/';
}
function token_for($exp) {
    return $exp . '.' . hash_hmac('sha256', (string)$exp, APP_PASSWORD . '|treino-v1');
}
function is_authed() {
    $c = $_COOKIE[COOKIE_NAME] ?? '';
    if ($c === '' || strpos($c, '.') === false) return false;
    $exp = explode('.', $c, 2)[0];
    if (!ctype_digit($exp) || (int)$exp < time()) return false;
    return hash_equals(token_for((int)$exp), $c);
}
function set_auth_cookie() {
    $exp = time() + COOKIE_DAYS * 86400;
    setcookie(COOKIE_NAME, token_for($exp), [
        'expires' => $exp, 'path' => cookie_path(),
        'httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']),
    ]);
}
function clear_auth_cookie() {
    setcookie(COOKIE_NAME, '', [
        'expires' => time() - 3600, 'path' => cookie_path(),
        'httponly' => true, 'samesite' => 'Lax',
    ]);
}

/* ---------------- dados padrão ---------------- */
function ex($id, $name, $sets, $reps, $ref = null, $mode = 'carga', $hint = '') {
    return ['id' => $id, 'name' => $name, 'sets' => $sets, 'reps' => $reps,
            'mode' => $mode, 'ref' => $ref, 'hint' => $hint];
}
function default_workouts() {
    return [
        'A' => ['name' => 'Peito, ombro e tríceps', 'exercises' => [
            ex('a1', 'Supino convergente máquina', 3, '8–10', 24.8),
            ex('a2', 'Supino inclinado máquina', 3, '10', 10, 'carga', 'Carga por lado (bilateral)'),
            ex('a3', 'Peck Deck', 3, '12', 18),
            ex('a4', 'Desenvolvimento máquina', 3, '10', 4.5),
            ex('a5', 'Elevação lateral', 3, '15', 3),
            ex('a6', 'Tríceps máquina (ou polia alta com barra V)', 3, '12', 24.8),
            ex('a7', 'Rotação externa (aparelho de ombro ou halter deitado)', 2, '15', 4.5),
            ex('a8', 'Face pull', 3, '15', 18, 'carga', 'Se a polia estiver ocupada: inverso no Peck Deck'),
        ]],
        'B' => ['name' => 'Costas, bíceps, trapézio e antebraço', 'exercises' => [
            ex('b1', 'Puxada alta pegada neutra', 3, '8–10'),
            ex('b2', 'Remada baixa máquina', 3, '10'),
            ex('b3', 'Remada articulada com apoio peitoral (Hammer Strength)', 3, '10'),
            ex('b4', 'Pullover máquina', 3, '12'),
            ex('b5', 'Rosca Scott máquina', 3, '10'),
            ex('b6', 'Rosca martelo (máquina ou halteres)', 3, '12'),
            ex('b7', 'Encolhimento máquina', 3, '12'),
            ex('b8', 'Flexão de punho máquina', 2, '15'),
            ex('b9', 'Extensão de punho máquina', 2, '15'),
        ]],
        'C' => ['name' => 'Pernas e core', 'exercises' => [
            ex('c1', 'Leg Press 45°', 4, '10', 20),
            ex('c2', 'Mesa flexora', 3, '10', 24.8),
            ex('c3', 'Cadeira extensora', 3, '12', 31.5),
            ex('c4', 'Cadeira abdutora', 3, '15', 51.8),
            ex('c5', 'Cadeira adutora', 3, '15', 24.8),
            ex('c6', 'Panturrilha sentado', 3, '15', 10),
            ex('c7', 'Panturrilha em pé na máquina', 3, '15'),
            ex('c8', 'Tibial anterior na máquina', 3, '20'),
            ex('c9', 'Crunch máquina', 3, '15'),
            ex('c10', 'Extensão lombar máquina', 3, '12'),
            ex('c11', 'Prancha', 3, '45–60 s', null, 'tempo'),
        ]],
    ];
}

/* ---------------- armazenamento (arquivo JSON protegido) ---------------- */
function load_store() {
    global $STORE;
    if (is_file($STORE)) {
        $raw = file_get_contents($STORE);
        if (strpos($raw, GUARD) === 0) $raw = substr($raw, strlen(GUARD));
        $d = json_decode($raw, true);
        if (is_array($d) && isset($d['workouts']) && is_array($d['workouts'])) {
            if (!isset($d['sessions']) || !is_array($d['sessions'])) $d['sessions'] = [];
            return $d;
        }
    }
    return ['workouts' => default_workouts(), 'sessions' => []];
}
function with_store(callable $fn) {
    global $DATA_DIR, $STORE;
    if (!is_dir($DATA_DIR) && !@mkdir($DATA_DIR, 0755, true)) fail('Não foi possível criar a pasta data/', 500);
    $lock = @fopen($DATA_DIR . '/.lock', 'c');
    if (!$lock) fail('Sem permissão de escrita na pasta data/ (ajuste as permissões para 755 ou 775)', 500);
    flock($lock, LOCK_EX);
    $store = $fn(load_store());
    if (is_file($STORE)) @copy($STORE, $DATA_DIR . '/store.bak.php');
    $json = json_encode($store, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    $ok = @file_put_contents($STORE, GUARD . $json);
    flock($lock, LOCK_UN);
    fclose($lock);
    if ($ok === false) fail('Não foi possível gravar os dados (permissão da pasta data/)', 500);
    return $store;
}

/* ---------------- validação ---------------- */
function s($v, $max) {
    $v = trim((string)$v);
    return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
}
function num($v) {
    if ($v === null || $v === '' || !is_numeric($v)) return null;
    $f = (float)$v;
    return is_finite($f) ? round($f, 2) : null;
}
function clean_id($v) {
    return substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$v), 0, 24);
}
function clean_workouts($in) {
    if (!is_array($in)) fail('Dados inválidos');
    $out = [];
    $seen = [];
    foreach (['A', 'B', 'C'] as $k) {
        $w = $in[$k] ?? null;
        if (!is_array($w)) fail("Treino $k inválido");
        $list = is_array($w['exercises'] ?? null) ? array_slice($w['exercises'], 0, 40) : [];
        $exs = [];
        foreach ($list as $e) {
            if (!is_array($e)) continue;
            $name = s($e['name'] ?? '', 100);
            if ($name === '') continue;
            $id = clean_id($e['id'] ?? '');
            if ($id === '' || isset($seen[$id])) $id = 'x' . bin2hex(random_bytes(5));
            $seen[$id] = true;
            $exs[] = [
                'id' => $id, 'name' => $name,
                'sets' => max(1, min(10, (int)($e['sets'] ?? 3))),
                'reps' => s($e['reps'] ?? '', 20),
                'mode' => (($e['mode'] ?? '') === 'tempo') ? 'tempo' : 'carga',
                'ref' => num($e['ref'] ?? null),
                'hint' => s($e['hint'] ?? '', 200),
            ];
        }
        $out[$k] = ['name' => s($w['name'] ?? '', 60), 'exercises' => $exs];
    }
    return $out;
}
function clean_session($in) {
    if (!is_array($in)) fail('Sessão inválida');
    $id = clean_id($in['id'] ?? '');
    if ($id === '') fail('Sessão sem id');
    $date = (string)($in['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail('Data inválida');
    $wk = $in['workout'] ?? '';
    if (!in_array($wk, ['A', 'B', 'C'], true)) fail('Treino inválido');
    $entries = [];
    $list = is_array($in['entries'] ?? null) ? array_slice($in['entries'], 0, 60) : [];
    foreach ($list as $e) {
        if (!is_array($e)) continue;
        $sets = [];
        foreach (array_slice(is_array($e['sets'] ?? null) ? $e['sets'] : [], 0, 20) as $st) {
            if (!is_array($st)) continue;
            $w = num($st['w'] ?? null);
            $r = num($st['r'] ?? null);
            if ($w === null && $r === null) continue;
            $sets[] = ['w' => $w, 'r' => $r];
        }
        if (!$sets) continue;
        $entries[] = [
            'exId' => clean_id($e['exId'] ?? ''),
            'name' => s($e['name'] ?? '', 100),
            'mode' => (($e['mode'] ?? '') === 'tempo') ? 'tempo' : 'carga',
            'sets' => $sets,
            'note' => s($e['note'] ?? '', 300),
        ];
    }
    if (!$entries) fail('Sessão vazia');
    $created = isset($in['created']) && is_numeric($in['created']) ? (int)$in['created'] : (int)(microtime(true) * 1000);
    return ['id' => $id, 'date' => $date, 'workout' => $wk, 'created' => $created, 'entries' => $entries];
}

/* ---------------- roteamento ---------------- */
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = [];
if ($method === 'POST') {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') fail('Requisição inválida', 400);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) $body = [];
}

if ($action === 'login' && $method === 'POST') {
    if (hash_equals((string)APP_PASSWORD, (string)($body['password'] ?? ''))) {
        set_auth_cookie();
        out(['ok' => true]);
    }
    sleep(1);
    fail('Senha incorreta', 401);
}
if ($action === 'logout' && $method === 'POST') {
    clear_auth_cookie();
    out(['ok' => true]);
}

if (!is_authed()) fail('auth', 401);

switch ($action) {
    case 'state':
        $st = load_store();
        out([
            'workouts' => $st['workouts'],
            'sessions' => array_values($st['sessions']),
            'warnDefaultPassword' => APP_PASSWORD === 'troque-esta-senha',
        ]);
    case 'saveWorkouts':
        $w = clean_workouts($body['workouts'] ?? null);
        with_store(function ($st) use ($w) { $st['workouts'] = $w; return $st; });
        out(['ok' => true, 'workouts' => $w]);
    case 'saveSession':
        $sess = clean_session($body['session'] ?? null);
        with_store(function ($st) use ($sess) {
            $found = false;
            foreach ($st['sessions'] as $i => $x) {
                if (($x['id'] ?? '') === $sess['id']) { $st['sessions'][$i] = $sess; $found = true; break; }
            }
            if (!$found) $st['sessions'][] = $sess;
            return $st;
        });
        out(['ok' => true, 'session' => $sess]);
    case 'deleteSession':
        $id = clean_id($body['id'] ?? '');
        with_store(function ($st) use ($id) {
            $st['sessions'] = array_values(array_filter($st['sessions'], fn($x) => ($x['id'] ?? '') !== $id));
            return $st;
        });
        out(['ok' => true]);
    default:
        fail('Ação desconhecida', 404);
}
