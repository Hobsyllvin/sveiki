import path from "path";
import fs from "fs";
import { CourseSchema } from "@/lib/content/schema";

export default function Home() {
  const coursePath = path.join(process.cwd(), "content/lv/course.json");
  const raw = JSON.parse(fs.readFileSync(coursePath, "utf-8"));
  const course = CourseSchema.parse(raw);

  return (
    <main className="p-8 font-mono">
      <h1 className="text-2xl font-bold mb-2">{course.languageName}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {course.language} · gloss language: {course.glossLanguage}
      </p>
      <ul className="space-y-2">
        {course.lessons.map((lesson) => (
          <li key={lesson.lessonId} className="border p-3 rounded">
            <span className="font-semibold">{lesson.lessonId}</span>
            <span className="ml-3 text-gray-600">{lesson.theme}</span>
            <span className="ml-3 text-xs bg-gray-100 px-1 rounded">{lesson.cefr}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
