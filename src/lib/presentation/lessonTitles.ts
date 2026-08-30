const DISPLAY_TITLES: Record<string, string> = {
  "lv-a1-01": "The First Hello",
  "lv-a1-02": "A Map of Us",
  "lv-a1-03": "Coffee, Cake & Conversation",
  "lv-a1-04": "A Saturday in Riga",
};

export function displayLessonTitle(lessonId: string, fallback: string): string {
  return DISPLAY_TITLES[lessonId] ?? fallback;
}
