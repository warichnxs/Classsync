<?php
session_start();
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Credentials: true");

$host = "localhost";
$dbname = "classsync";
$dbuser = "root";
$dbpass = "";

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $dbuser, $dbpass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed. Check your database name and setup."]);
    exit;
}

$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents("php://input"), true) ?? [];

function send_ok($data = []) {
    echo json_encode($data);
    exit;
}

function send_err($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(["error" => $msg]);
    exit;
}

function require_auth() {
    if (!isset($_SESSION['user_id'])) {
        send_err("Please log in.", 401);
    }
    return $_SESSION;
}

// Returns true if the room already has a booking that overlaps the given time.
// $statuses = which booking statuses count as "taking" the room.
function has_conflict($pdo, $roomId, $date, $start, $end, $statuses, $excludeId = 0) {
    $in = "'" . implode("','", $statuses) . "'";
    $stmt = $pdo->prepare("SELECT id FROM bookings
        WHERE roomId = ? AND date = ? AND status IN ($in) AND id != ?
        AND (start < ? AND end > ?) LIMIT 1");
    $stmt->execute([$roomId, $date, $excludeId, $end, $start]);
    return (bool) $stmt->fetch();
}

// --- Actions ---
if ($action === 'setup_db') {
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        firstName VARCHAR(50) NOT NULL,
        lastName VARCHAR(50) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('user','admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS rooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        capacity INT NOT NULL,
        equipment VARCHAR(255) NOT NULL DEFAULT ''
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        roomId INT NOT NULL,
        date DATE NOT NULL,
        start TIME NOT NULL,
        end TIME NOT NULL,
        purpose VARCHAR(255) NOT NULL,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    $check = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $check->execute(['admin@classsync.com']);
    if (!$check->fetch()) {
        $ins = $pdo->prepare("INSERT INTO users (firstName, lastName, email, password, role) VALUES (?, ?, ?, ?, 'admin')");
        $ins->execute(['Admin', 'User', 'admin@classsync.com', password_hash('admin123', PASSWORD_DEFAULT)]);
    }

    $checkRooms = $pdo->query("SELECT COUNT(*) FROM rooms")->fetchColumn();
    if (!$checkRooms) {
        $insRooms = $pdo->prepare("INSERT INTO rooms (name, capacity, equipment) VALUES (?, ?, ?)");
        $insRooms->execute(['AVR (Audio-Visual Room)', 80, 'Projector, Sound system, Air-con']);
        $insRooms->execute(['Computer Lab', 30, '30 PCs, Projector, Air-con']);
        $insRooms->execute(['Room 101', 40, 'Whiteboard, Projector']);
        $insRooms->execute(['Room 102', 40, 'Whiteboard']);
        $insRooms->execute(['Room 201', 35, 'Whiteboard, Projector, Air-con']);
    }

    send_ok(["message" => "Database setup complete."]);
}

elseif ($action === 'register') {
    $firstName = trim($input['firstName'] ?? '');
    $lastName = trim($input['lastName'] ?? '');
    $email = strtolower(trim($input['email'] ?? ''));
    $password = $input['password'] ?? '';
    $password2 = $input['password2'] ?? '';

    if (!$firstName || !$lastName || !$email) send_err("Please fill in all fields.");
    if (strlen($password) < 6) send_err("Password must be at least 6 characters.");
    if ($password !== $password2) send_err("Passwords do not match.");

    try {
        $stmt = $pdo->prepare("INSERT INTO users (firstName, lastName, email, password) VALUES (?, ?, ?, ?)");
        $stmt->execute([$firstName, $lastName, $email, password_hash($password, PASSWORD_DEFAULT)]);
        send_ok(["message" => "Account created successfully!"]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'Duplicate entry') !== false) {
            send_err("This email is already registered.");
        }
        send_err("Registration failed.");
    }
}

elseif ($action === 'login') {
    $email = strtolower(trim($input['email'] ?? ''));
    $password = $input['password'] ?? '';

    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? LIMIT 1");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user && password_verify($password, $user['password'])) {
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_name'] = $user['firstName'] . ' ' . $user['lastName'];
        $_SESSION['user_role'] = $user['role'];
        send_ok(["user" => [
            "id" => $user['id'],
            "name" => $user['firstName'] . ' ' . $user['lastName'],
            "role" => $user['role']
        ]]);
    }
    send_err("Incorrect email or password.");
}

elseif ($action === 'logout') {
    session_destroy();
    send_ok(["message" => "Logged out."]);
}

elseif ($action === 'me') {
    if (!isset($_SESSION['user_id'])) {
        send_err("Not logged in.", 401);
    }
    $userStmt = $pdo->prepare("SELECT id, firstName, lastName, email, role FROM users WHERE id = ? LIMIT 1");
    $userStmt->execute([$_SESSION['user_id']]);
    $user = $userStmt->fetch(PDO::FETCH_ASSOC);

    $rooms = $pdo->query("SELECT * FROM rooms ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);

    // keep the role in the display name format the front end expects
    $user['name'] = $user['firstName'] . ' ' . $user['lastName'];

    send_ok(["user" => $user, "rooms" => $rooms]);
}

elseif ($action === 'calendar') {
    require_auth();
    $date = $_GET['date'] ?? date('Y-m-d');
    $stmt = $pdo->prepare("SELECT b.*, CONCAT(u.firstName, ' ', u.lastName) AS userName, r.name AS roomName
        FROM bookings b
        JOIN users u ON b.userId = u.id
        JOIN rooms r ON b.roomId = r.id
        WHERE b.date = ? AND b.status != 'rejected'
        ORDER BY b.start");
    $stmt->execute([$date]);
    send_ok(["bookings" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

elseif ($action === 'mine') {
    $sess = require_auth();
    $stmt = $pdo->prepare("SELECT b.*, r.name AS roomName
        FROM bookings b
        JOIN rooms r ON b.roomId = r.id
        WHERE b.userId = ?
        ORDER BY b.date DESC, b.start");
    $stmt->execute([$sess['user_id']]);
    send_ok(["bookings" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

elseif ($action === 'book') {
    $sess = require_auth();
    $roomId = intval($input['roomId'] ?? 0);
    $date = $input['date'] ?? '';
    $start = $input['start'] ?? '';
    $end = $input['end'] ?? '';
    $purpose = trim($input['purpose'] ?? '');

    if (!$roomId || !$date || !$start || !$end || !$purpose) send_err("Please fill in all fields.");
    if ($end <= $start) send_err("End time must be after start time.");

    // Waiting (pending) and approved bookings both hold the room
    if (has_conflict($pdo, $roomId, $date, $start, $end, ['pending', 'approved'])) {
        send_err("Sorry, that room is not free at that time. Please choose another time.");
    }

    $stmt = $pdo->prepare("INSERT INTO bookings (userId, roomId, date, start, end, purpose) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$sess['user_id'], $roomId, $date, $start, $end, $purpose]);
    send_ok(["message" => "Booking request sent!"]);
}

elseif ($action === 'cancel') {
    $sess = require_auth();
    $id = intval($input['id'] ?? 0);
    $stmt = $pdo->prepare("DELETE FROM bookings WHERE id = ? AND userId = ? AND status = 'pending'");
    $stmt->execute([$id, $sess['user_id']]);
    if ($stmt->rowCount() > 0) send_ok(["message" => "Request cancelled."]);
    send_err("Cannot cancel this request.");
}

elseif ($action === 'admin') {
    $sess = require_auth();
    if ($sess['user_role'] !== 'admin') send_err("Admin access required.", 403);

    $pending = $pdo->query("SELECT b.*, CONCAT(u.firstName, ' ', u.lastName) AS userName, r.name AS roomName
        FROM bookings b JOIN users u ON b.userId = u.id JOIN rooms r ON b.roomId = r.id
        WHERE b.status = 'pending' ORDER BY b.date, b.start")->fetchAll(PDO::FETCH_ASSOC);

    // mark pending requests that overlap an already approved booking
    foreach ($pending as &$p) {
        $p['clash'] = has_conflict($pdo, $p['roomId'], $p['date'], $p['start'], $p['end'], ['approved'], $p['id']);
    }
    unset($p);

    $others = $pdo->query("SELECT b.*, CONCAT(u.firstName, ' ', u.lastName) AS userName, r.name AS roomName
        FROM bookings b JOIN users u ON b.userId = u.id JOIN rooms r ON b.roomId = r.id
        WHERE b.status != 'pending' ORDER BY b.date DESC, b.start DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);

    $report = $pdo->query("SELECT r.id, r.name, COUNT(b.id) AS total,
        COALESCE(SUM(TIME_TO_SEC(TIMEDIFF(b.end, b.start)) / 3600), 0) AS hours
        FROM rooms r LEFT JOIN bookings b ON r.id = b.roomId AND b.status = 'approved'
        GROUP BY r.id, r.name ORDER BY r.name")->fetchAll(PDO::FETCH_ASSOC);

    send_ok(["pending" => $pending, "others" => $others, "report" => $report]);
}

elseif ($action === 'answer') {
    $sess = require_auth();
    if ($sess['user_role'] !== 'admin') send_err("Admin access required.", 403);
    $id = intval($input['id'] ?? 0);
    $status = $input['status'] ?? '';
    if (!in_array($status, ['approved', 'rejected'])) send_err("Invalid status.");

    if ($status === 'approved') {
        $row = $pdo->prepare("SELECT roomId, date, start, end FROM bookings WHERE id = ? LIMIT 1");
        $row->execute([$id]);
        $b = $row->fetch(PDO::FETCH_ASSOC);
        if (!$b) send_err("Request not found.", 404);
        if (has_conflict($pdo, $b['roomId'], $b['date'], $b['start'], $b['end'], ['approved'], $id)) {
            send_err("Cannot approve: this overlaps an approved booking.");
        }
    }

    $stmt = $pdo->prepare("UPDATE bookings SET status = ? WHERE id = ?");
    $stmt->execute([$status, $id]);
    send_ok(["message" => "Status updated."]);
}

else {
    send_err("Unknown action: $action", 404);
}
?>