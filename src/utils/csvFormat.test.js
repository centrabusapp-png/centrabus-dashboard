import { csvCell, philippineCsvTime } from './csvFormat';

test('Philippine CSV times preserve the day, hour and seconds as explicit spreadsheet text', () => {
  expect(philippineCsvTime('2026-10-25T16:56:08.123Z')).toEqual({ date: '2026-10-26', time: '12:56:08 AM PHT' });
  expect(philippineCsvTime('2026-10-26T04:03:47.999Z')).toEqual({ date: '2026-10-26', time: '12:03:47 PM PHT' });
  expect(philippineCsvTime('bad')).toEqual({ date: '', time: '' });
});
test('CSV preserves true zero and blanks while blocking whitespace-prefixed formulas', () => {
  expect(csvCell(0)).toBe('"0"');
  expect(csvCell(null)).toBe('""');
  expect(csvCell('\t=SUM(1,2)')).toBe('"\'\t=SUM(1,2)"');
  expect(csvCell('Bus, "04"')).toBe('"Bus, ""04"""');
});
