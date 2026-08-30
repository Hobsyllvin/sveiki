import { loadCourse } from "@/lib/content/load";
import { displayLessonTitle } from "@/lib/presentation/lessonTitles";
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
      <header className="home-masthead">
        <p className="home-eyebrow">Language field notes · 01</p>
        <h1 className="home-title">Valoda</h1>
        <div className="home-intro">
          <p className="home-subtitle">Learn languages through interlinear reading.</p>
          <p className="home-method">Read closely. Hear the rhythm. Keep the words.</p>
        </div>
      </header>

      {courses.map((course) => (
        <section key={course.language} className="home-course">
          <p className="home-course-meta">
            {course.lessons.length} studies · {course.glossLanguage} gloss
          </p>
          <ul className="home-lesson-list">
            {course.lessons.map((lesson, index) => (
              <li key={lesson.lessonId}>
                <Link href={`/lessons/${lesson.lessonId}`} className="home-lesson-link">
                  <span className="home-lesson-id">{String(index + 1).padStart(2, "0")}</span>
                  <span className="home-lesson-theme">
                    <span className="home-lesson-label">Lesson {lesson.lessonId.slice(-2)}</span>
                    {displayLessonTitle(lesson.lessonId, lesson.theme)}
                  </span>
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
