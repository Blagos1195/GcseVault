SELECT 'credentials' AS dataset,
  (SELECT COUNT(*) FROM account_credentials) AS source_rows,
  (SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL) AS target_rows,
  (SELECT COUNT(*) FROM account_credentials c LEFT JOIN users u ON u.user_key = c.user_key
   WHERE u.user_key IS NULL OR u.password_hash IS NOT c.password_hash OR u.password_salt IS NOT c.password_salt
      OR u.credential_created_at IS NOT c.created_at OR u.credential_updated_at IS NOT c.updated_at) AS mismatches;

SELECT 'revision_sync_data' AS dataset,
  (SELECT COUNT(*) FROM revision_sync_data) AS source_rows,
  (SELECT COUNT(*) FROM users WHERE revision_data_json IS NOT NULL) +
  (SELECT COUNT(*) FROM kv_store WHERE namespace = 'REVISION_SYNC_ORPHAN') AS target_rows,
  (SELECT COUNT(*) FROM revision_sync_data r LEFT JOIN users u ON u.user_key = r.user_key
   WHERE u.user_key IS NOT NULL AND (u.revision_data_json IS NOT r.data_json OR u.revision_updated_at IS NOT r.updated_at)) +
  (SELECT COUNT(*) FROM revision_sync_data r LEFT JOIN users u ON u.user_key = r.user_key
   WHERE u.user_key IS NULL AND NOT EXISTS (
     SELECT 1 FROM kv_store k WHERE k.namespace = 'REVISION_SYNC_ORPHAN'
       AND k.key = r.user_key AND k.value = r.data_json AND k.updated_at = r.updated_at
   )) AS mismatches;

SELECT 'revision_leaderboard' AS dataset,
  (SELECT COUNT(*) FROM revision_leaderboard) AS source_rows,
  (SELECT COUNT(*) FROM users WHERE revision_leaderboard_updated_at IS NOT NULL) +
  (SELECT COUNT(*) FROM kv_store WHERE namespace = 'REVISION_LEADERBOARD_ORPHAN') AS target_rows,
  (SELECT COUNT(*) FROM revision_leaderboard r LEFT JOIN users u ON u.user_key = r.user_key
   WHERE u.user_key IS NOT NULL AND (
     u.username IS NOT r.username OR u.revision_xp IS NOT r.xp OR
     u.revision_streak IS NOT r.streak OR
     u.revision_leaderboard_updated_at IS NOT r.updated_at
   )) +
  (SELECT COUNT(*) FROM revision_leaderboard r LEFT JOIN users u ON u.user_key = r.user_key
   WHERE u.user_key IS NULL AND NOT EXISTS (
     SELECT 1 FROM kv_store k
     WHERE k.namespace = 'REVISION_LEADERBOARD_ORPHAN' AND k.key = r.user_key
       AND json_extract(k.value, '$.username') IS r.username
       AND json_extract(k.value, '$.xp') IS r.xp
       AND json_extract(k.value, '$.streak') IS r.streak
       AND json_extract(k.value, '$.updatedAt') IS r.updated_at
   )) AS mismatches;

SELECT 'admin_notifications' AS dataset,
  (SELECT COUNT(*) FROM admin_notifications) AS source_rows,
  (SELECT COUNT(*) FROM notifications WHERE kind = 'admin') AS target_rows,
  (SELECT COUNT(*) FROM admin_notifications a LEFT JOIN notifications n ON n.kind = 'admin' AND n.id = a.id
   WHERE n.id IS NULL OR n.user_key IS NOT a.user_key OR n.site IS NOT a.site OR n.item_id IS NOT a.item_id
      OR n.title IS NOT a.title OR n.submitter IS NOT a.submitter OR n.created_at IS NOT a.created_at OR n.read_at IS NOT a.read_at) AS mismatches;

SELECT 'submission_notifications' AS dataset,
  (SELECT COUNT(*) FROM submission_notifications) AS source_rows,
  (SELECT COUNT(*) FROM notifications WHERE kind = 'submission') AS target_rows,
  (SELECT COUNT(*) FROM submission_notifications s LEFT JOIN notifications n ON n.kind = 'submission' AND n.id = s.id
   WHERE n.id IS NULL OR n.user_key IS NOT s.user_key OR n.site IS NOT s.site OR n.item_id IS NOT s.item_id
      OR n.title IS NOT s.title OR n.status IS NOT s.status OR n.payload IS NOT s.payload
      OR n.created_at IS NOT s.created_at OR n.acknowledged_at IS NOT s.acknowledged_at OR n.choice IS NOT s.choice) AS mismatches;

SELECT 'moderation_audit' AS dataset,
  (SELECT COUNT(*) FROM moderation_audit) AS source_rows,
  (SELECT COUNT(*) FROM audit_log WHERE event_type = 'moderation') AS target_rows,
  (SELECT COUNT(*) FROM moderation_audit m WHERE NOT EXISTS (
    SELECT 1 FROM audit_log a WHERE a.event_type = 'moderation' AND a.site IS m.site
      AND a.item_id IS m.item_id AND a.item_title IS m.item_title AND a.submitted_by IS m.submitted_by
      AND a.actor_username IS m.moderator AND a.action IS m.action AND a.acted_at IS m.acted_at
  )) AS mismatches;

SELECT 'admin_account_audit' AS dataset,
  (SELECT COUNT(*) FROM admin_account_audit) AS source_rows,
  (SELECT COUNT(*) FROM audit_log WHERE event_type = 'account') AS target_rows,
  (SELECT COUNT(*) FROM admin_account_audit m WHERE NOT EXISTS (
    SELECT 1 FROM audit_log a WHERE a.event_type = 'account' AND a.target_username IS m.target_username
      AND a.actor_username IS m.actor_username AND a.action IS m.action AND a.acted_at IS m.acted_at
  )) AS mismatches;

SELECT 'test_run_history' AS dataset,
  (SELECT COUNT(*) FROM test_run_history) AS source_rows,
  (SELECT COUNT(*) FROM audit_log WHERE event_type = 'test') AS target_rows,
  (SELECT COUNT(*) FROM test_run_history m WHERE NOT EXISTS (
    SELECT 1 FROM audit_log a WHERE a.event_type = 'test' AND a.actor_username IS m.actor_username
      AND a.test_name IS m.test_name AND a.status IS m.status AND a.detail IS m.detail
      AND a.duration_ms IS m.duration_ms AND a.acted_at IS m.completed_at
  )) AS mismatches;

SELECT 'custom_themes' AS dataset,
  (SELECT COUNT(*) FROM custom_themes) AS source_rows,
  (SELECT COUNT(*) FROM kv_store WHERE namespace = 'THEMES' AND key LIKE 'theme:%') AS target_rows,
  (SELECT COUNT(*) FROM custom_themes c LEFT JOIN kv_store k
   ON k.namespace = 'THEMES' AND k.key = 'theme:' || c.user_key || ':' || c.theme_key
   WHERE k.key IS NULL OR k.value IS NOT c.theme_json) AS mismatches;

SELECT 'account_course_selections' AS dataset,
  (SELECT COUNT(*) FROM account_course_selections) AS source_rows,
  (SELECT COUNT(*) FROM kv_store WHERE namespace = 'USER_DATA' AND key LIKE 'course:%') AS target_rows,
  (SELECT COUNT(*) FROM account_course_selections c LEFT JOIN kv_store k
   ON k.namespace = 'USER_DATA' AND k.key = 'course:' || c.user_key || ':' || c.site
   WHERE k.key IS NULL OR k.value IS NOT c.selections_json) AS mismatches;

SELECT 'review_schedules' AS dataset,
  (SELECT COUNT(*) FROM review_schedules) AS source_rows,
  (SELECT COUNT(*) FROM kv_store WHERE namespace = 'USER_DATA' AND key LIKE 'schedules:%') AS target_rows,
  (SELECT COUNT(*) FROM review_schedules c LEFT JOIN kv_store k
   ON k.namespace = 'USER_DATA' AND k.key = 'schedules:' || c.user_key || ':' || c.site
   WHERE k.key IS NULL OR k.value IS NOT c.schedules_json) AS mismatches;

SELECT namespace, COUNT(*) AS total_keys,
  SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= unixepoch() THEN 1 ELSE 0 END) AS expired_keys
FROM kv_store
GROUP BY namespace
ORDER BY namespace;
