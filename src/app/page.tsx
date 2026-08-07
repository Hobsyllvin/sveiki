import { loadCourse } from "@/lib/content/load";
import Link from "next/link";
import fs from "fs";
import path from "path";

function allLangs(): string[] {
  const dir = path.join(process.cwd(), "content");
  return fs
    .readdirSync(dir)
    .filter((d) => !d.startsWith("_") && fs.statSync(path.join(dir, d)).isDirectory());
}

export default function Home() {
  const langs = allLangs();
  const courses = langs.map((lang) => loadCourse(lang));

  return (
    <main className="home-page">
      <h1 className="home-title">Valoda</h1>
      <p className="home-subtitle">Learn languages through interlinear reading</p>
      {courses.map((course) => (
        <section key={course.language} className="home-course">
          <h2 className="home-course-name">{course.languageName}</h2>
          <ul className="home-lesson-list">
            {course.lessons.map((lesson) => (
              <li key={lesson.lessonId}>
                <Link href={`/lessons/${lesson.lessonId}`} className="home-lesson-link">
                  <span className="home-lesson-id">{lesson.lessonId}</span>
                  <span className="home-lesson-theme">{lesson.theme}</span>
                  <span className="home-cefr-badge">{lesson.cefr}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
