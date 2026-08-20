import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real incident, 2026-08-20: CBSE Class 11 Biology "The Living World" (ch.1,
// unscoped book) was reported "already loaded" — knowledge_base actually held
// ZERO rows for it. Root cause: chapterKeyFor() deliberately leaves subject
// out of the key string ('c11_ch01') — the real uniqueness lives in the DB's
// (exam_type, subject, chapter_key) index (chapterIdentity.js:36) — but
// checkAlreadyLoaded queried knowledge_base by chapter_key ALONE, with no
// exam_type/subject filter, so it matched CBSE Class 11 Accountancy's
// "Introduction to Accounting" (also ch.1, also unscoped book, also
// 'c11_ch01', genuinely loaded) instead.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  adminSaveKnowledgeChunks: vi.fn(),
}));

import { supabase } from '../../lib/supabase';
import { checkAlreadyLoaded } from '../AdminContentIntake';

const LIVING_WORLD_ENTRY = { ordinal: 1, title: 'The Living World', numbered: true, fileOrdinal: 1 };

// `rows` are the ONLY rows the real table would return for a query correctly
// scoped by exam_type+subject+chapter_key — a mock that ignores .eq() would
// hide exactly the bug this test exists to catch, so the mock filters for real.
function mockKnowledgeBase(rows) {
  supabase.from.mockImplementation((table) => {
    expect(table).toBe('knowledge_base');
    const filters = {};
    const builder = {
      select: () => builder,
      eq: (col, val) => { filters[col] = val; return builder; },
      in: (col, vals) => { filters[col] = vals; return builder; },
      limit: () => Promise.resolve({
        data: rows.filter((r) =>
          (filters.exam_type === undefined || r.exam_type === filters.exam_type) &&
          (filters.subject === undefined || r.subject === filters.subject) &&
          (!filters.chapter_key || filters.chapter_key.includes(r.chapter_key))),
        error: null,
      }),
    };
    return builder;
  });
}

describe('checkAlreadyLoaded — must scope by (exam_type, subject), not chapter_key alone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT false-flag Biology ch.1 as loaded when only Accountancy ch.1 (same colliding key) has rows', async () => {
    mockKnowledgeBase([
      { exam_type: 'CBSE Class 11', subject: 'Accountancy', chapter_key: 'c11_ch01' },
    ]);

    const dup = await checkAlreadyLoaded(
      [LIVING_WORLD_ENTRY], 'Chapter 1 The Living World.pdf', '11', null,
      'CBSE Class 11', 'Biology',
    );

    expect(dup.keys).toEqual(['c11_ch01']);
    expect(dup.loadedKeys).toEqual([]); // zero real Biology rows -> must not warn
  });

  it('DOES flag Biology ch.1 as loaded when Biology itself has real rows under that key', async () => {
    mockKnowledgeBase([
      { exam_type: 'CBSE Class 11', subject: 'Accountancy', chapter_key: 'c11_ch01' },
      { exam_type: 'CBSE Class 11', subject: 'Biology', chapter_key: 'c11_ch01' },
    ]);

    const dup = await checkAlreadyLoaded(
      [LIVING_WORLD_ENTRY], 'Chapter 1 The Living World.pdf', '11', null,
      'CBSE Class 11', 'Biology',
    );

    expect(dup.loadedKeys).toEqual(['c11_ch01']);
  });

  it('the underlying query is actually filtered by exam_type and subject, not just chapter_key', async () => {
    const eq = vi.fn().mockReturnThis();
    const inFn = vi.fn().mockReturnThis();
    const builder = { select: vi.fn().mockReturnThis(), eq, in: inFn, limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    supabase.from.mockReturnValue(builder);

    await checkAlreadyLoaded([LIVING_WORLD_ENTRY], 'Chapter 1 The Living World.pdf', '11', null, 'CBSE Class 11', 'Biology');

    expect(eq).toHaveBeenCalledWith('exam_type', 'CBSE Class 11');
    expect(eq).toHaveBeenCalledWith('subject', 'Biology');
  });
});
