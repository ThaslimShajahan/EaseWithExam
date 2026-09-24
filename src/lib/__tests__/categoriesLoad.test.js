import { describe, it, expect, vi } from 'vitest';

// exam_categories / subjects rows as the DB returns them (shape of
// migration 20260925000000). Separate file so the mocked load can't leak into
// categories.test.js, which covers the pre-load state.
const EXAM_ROWS = [
  { exam_key: 'JEE Advanced', label: 'JEE Adv.', category_kind: 'competitive', board_key: null, class_key: null,
    group_label: 'Engineering', subjects: ['Physics', 'Chemistry', 'Mathematics'], hidden_subjects: [],
    content_sources: ['CBSE Class 11', 'CBSE Class 12'], sort_order: 1 },
  { exam_key: 'CBSE Class 8', label: 'CBSE Class 8', category_kind: 'board_class', board_key: 'CBSE', class_key: '8',
    group_label: 'CBSE', subjects: ['Mathematics', 'Science', 'English', 'Hindi'], hidden_subjects: ['Hindi'],
    content_sources: [], sort_order: 2 },
  { exam_key: 'CBSE', label: 'CBSE Board', category_kind: 'board', board_key: 'CBSE', class_key: null,
    group_label: 'CBSE', subjects: ['Mathematics'], hidden_subjects: [], content_sources: [], sort_order: 3 },
];

vi.mock('../supabase', () => {
  const query = (rows) => {
    const q = { eq: () => q, order: () => q, then: (res) => res({ data: rows, error: null }) };
    return q;
  };
  return {
    supabase: {
      from: (table) => ({
        select: () => (table === 'exam_categories' ? query(EXAM_ROWS) : query([])),
      }),
    },
  };
});

describe('loadCategories — exam_categories is the single source', () => {
  it('fills subjects, hidden lists and content sources from the DB', async () => {
    // Read CATEGORIES through the module object: destructuring it from a
    // dynamic import would snapshot the pre-load value (static imports in app
    // code are live bindings and don't have this problem).
    const categories = await import('../categories');
    const { loadCategories, getSubjectsForExam } = categories;
    const { examTypesFor } = await import('../examMapping');

    expect(getSubjectsForExam('JEE Advanced')).toEqual([]);      // before load
    await loadCategories();

    expect(getSubjectsForExam('JEE Advanced')).toEqual(['Physics', 'Chemistry', 'Mathematics']);
    expect(getSubjectsForExam('JEE Advanced')).not.toContain('English');

    // Admin-side list keeps hidden subjects (admins still manage them);
    // the hidden list is carried alongside for the admin screen.
    expect(getSubjectsForExam('CBSE Class 8')).toContain('Hindi');
    expect(categories.CATEGORIES['CBSE Class 8'].hidden).toEqual(['Hindi']);

    // content_sources replaces the old hardcoded CORPUS_FALLBACK.
    expect(examTypesFor('JEE Advanced')).toEqual(['JEE Advanced', 'CBSE Class 11', 'CBSE Class 12']);
    expect(examTypesFor('CBSE Class 8')).toEqual(['CBSE Class 8']);
  });
});
