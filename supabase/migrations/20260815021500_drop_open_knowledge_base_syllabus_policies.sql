-- Second half of the knowledge_base/syllabus_nodes lockdown (20260815020000).
-- Run only now that the updated client (adminSaveKnowledgeChunks routing
-- through admin_insert_knowledge_chunks, AdminSyllabus.jsx's bulk inserts
-- and exam_type migration routing through their RPCs) is confirmed
-- deployed and live — same ordering discipline as the pyq_questions
-- lockdown. Running this first would have broken every admin write in the
-- gap before the client caught up.
drop policy if exists knowledge_base_open on public.knowledge_base;
drop policy if exists sn_admin_write on public.syllabus_nodes;
