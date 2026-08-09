<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';

Helper::handleCorsOptions();

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    $method = $_SERVER['REQUEST_METHOD'];

    // GET: Fetch question bank and exams for a teacher
    if ($method === 'GET') {
        $teacherId = isset($_GET['teacher_id']) ? (int)$_GET['teacher_id'] : 1;

        $stmtQb = $db->prepare('SELECT * FROM question_bank WHERE teacher_id = :tid ORDER BY id DESC');
        $stmtQb->execute(['tid' => $teacherId]);
        $questionsRaw = $stmtQb->fetchAll();

        $questions = [];
        foreach ($questionsRaw as $row) {
            $questions[] = [
                'id' => (int)$row['id'],
                'teacher_id' => (int)$row['teacher_id'],
                'class_id' => (int)$row['class_id'],
                'subject' => (string)$row['subject'],
                'question_type' => (string)$row['question_type'],
                'question_text' => (string)$row['question_text'],
                'options' => json_decode((string)$row['options'], true) ?: [],
                'correct_option' => (string)$row['correct_option'],
                'points' => (float)$row['points'],
                'difficulty' => (string)$row['difficulty']
            ];
        }

        $stmtEx = $db->prepare('SELECT * FROM exams WHERE teacher_id = :tid ORDER BY id DESC');
        $stmtEx->execute(['tid' => $teacherId]);
        $exams = $stmtEx->fetchAll();

        Helper::sendJson([
            'success' => true,
            'questions' => $questions,
            'exams' => $exams
        ]);
    }

    // POST: Add Question (4 Types) or Create Exam
    if ($method === 'POST') {
        $input = Helper::getJsonInput();
        $action = Helper::sanitizeString($input['action'] ?? '');
        $payload = is_array($input['payload'] ?? null) ? $input['payload'] : [];
        $teacherId = (int)($payload['teacher_id'] ?? 1);

        // Add Question to Bank (4 types: mcq, true_false, essay, bubble_sheet)
        if ($action === 'create_question') {
            $classId = (int)($payload['class_id'] ?? 1);
            $subject = Helper::sanitizeString($payload['subject'] ?? 'أسئلة عامة');
            $questionType = Helper::sanitizeString($payload['question_type'] ?? 'mcq');
            $questionText = Helper::sanitizeString($payload['question_text'] ?? '');
            $options = json_encode($payload['options'] ?? [], JSON_UNESCAPED_UNICODE);
            $correctOption = Helper::sanitizeString($payload['correct_option'] ?? '');
            $points = (float)($payload['points'] ?? 2.0);

            $stmt = $db->prepare('
                INSERT INTO question_bank (teacher_id, class_id, subject, question_type, question_text, options, correct_option, points, difficulty)
                VALUES (:tid, :cid, :subj, :qtype, :qtext, :opts, :correct, :points, "medium")
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'cid' => $classId,
                'subj' => $subject,
                'qtype' => $questionType,
                'qtext' => $questionText,
                'opts' => $options,
                'correct' => $correctOption,
                'points' => $points
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم حفظ السؤال في بنك الأسئلة بنجاح', 'id' => (int)$db->lastInsertId()]);
        }

        // Create Exam
        if ($action === 'create_exam') {
            $classId = (int)($payload['class_id'] ?? 1);
            $groupId = isset($payload['group_id']) ? (int)$payload['group_id'] : null;
            $title = Helper::sanitizeString($payload['title'] ?? '');
            $date = Helper::sanitizeString($payload['date'] ?? date('Y-m-d'));
            $time = Helper::sanitizeString($payload['time'] ?? '05:00 مساءً');
            $duration = (int)($payload['duration_minutes'] ?? 60);
            $examType = Helper::sanitizeString($payload['exam_type'] ?? 'monthly');
            $totalPoints = (float)($payload['total_points'] ?? 100.0);
            $questionIds = is_array($payload['question_ids'] ?? null) ? $payload['question_ids'] : [];

            $db->beginTransaction();
            try {
                $stmtEx = $db->prepare('
                    INSERT INTO exams (teacher_id, class_id, group_id, title, date, time, duration_minutes, exam_type, total_points, is_published)
                    VALUES (:tid, :cid, :gid, :title, :date, :time, :dur, :etype, :pts, 1)
                ');
                $stmtEx->execute([
                    'tid' => $teacherId,
                    'cid' => $classId,
                    'gid' => $groupId,
                    'title' => $title,
                    'date' => $date,
                    'time' => $time,
                    'dur' => $duration,
                    'etype' => $examType,
                    'pts' => $totalPoints
                ]);
                $examId = (int)$db->lastInsertId();

                if (!empty($questionIds)) {
                    $stmtLink = $db->prepare('
                        INSERT INTO exam_questions (exam_id, question_id, order_index, points)
                        VALUES (:eid, :qid, :idx, 5.00)
                    ');
                    foreach ($questionIds as $idx => $qId) {
                        $stmtLink->execute([
                            'eid' => $examId,
                            'qid' => (int)$qId,
                            'idx' => $idx + 1
                        ]);
                    }
                }

                $db->commit();
                Helper::sendJson(['success' => true, 'message' => 'تم إنشاء الامتحان وربط الأسئلة بنجاح', 'exam_id' => $examId]);

            } catch (Throwable $ex) {
                $db->rollBack();
                throw $ex;
            }
        }

        Helper::sendJson(['success' => false, 'error' => 'إجراء غير معروف في الامتحانات'], 400);
    }

    Helper::sendJson(['success' => false, 'error' => 'طريقة الطلب غير مسموح بها'], 405);

} catch (Throwable $exception) {
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر الامتحانات: ' . $exception->getMessage()
    ], 500);
}
