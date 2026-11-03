export function validateIntake(form) {
  const errors = {}

  const hasResumeText = Boolean(form.resumeText && form.resumeText.trim().length > 30)
  const hasResumeFile = Boolean(form.resumeFile && form.resumeFile.name)

  if (!hasResumeText && !hasResumeFile) {
    errors.resume = 'A resume is required. Please upload a PDF or DOCX file, or paste your resume text.'
  }

  const hasGithub = Boolean(form.githubUser || (form.githubUrl && form.githubUrl.trim().length > 2))
  if (!hasGithub) {
    errors.evidence = 'An evidence source is required. Connect your GitHub account or enter a valid public GitHub URL.'
  }

  if (!form.targetRole || form.targetRole.trim().length < 3) {
    errors.targetRole = 'A target role or job description is required to calculate match states and evidence gaps.'
  }

  if (!form.consentAi) {
    errors.consentAi = 'Consent to process resume text and code snippets with language models is required.'
  }

  if (!form.consentRepo) {
    errors.consentRepo = 'Consent for read-only access to inspect repositories and commit history is required.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export const SAMPLE_RESUME_TEXT = `ALEX RIVERA
Full Stack Engineer | alex.rivera@example.com | github.com/alexrivera-dev

PROFESSIONAL SUMMARY
Full Stack Engineer with 4 years of experience building TypeScript, React, and Node.js web applications. Track record of implementing REST APIs, Docker containerization, and test suites with high code coverage.

CORE TECHNICAL SKILLS
- Languages: TypeScript, JavaScript, SQL, HTML5, CSS3, Rust (Intermediate)
- Frontend: React 18, Next.js, Redux Toolkit, Webpack, Tailwind CSS
- Backend: Node.js, Express, REST APIs, PostgreSQL, Redis
- Infrastructure: Docker, Docker Compose, Git workflow, CI/CD Actions, Linux
- Testing: Jest, React Testing Library, Supertest, Unit testing
- Additional Claims: Kubernetes cluster orchestration, System design documentation

PROFESSIONAL EXPERIENCE
Senior Frontend Developer - Acme SaaS (2023 - Present)
- Architected candidate dashboards in React and TypeScript across 31 production files.
- Refactored state management using custom React hooks to isolate side effects.
- Set up automated Jest and React Testing Library workflows on pull requests.

Backend Software Engineer - CloudCore Systems (2021 - 2023)
- Implemented authenticated REST API endpoints in Node.js and Express with JWT validation.
- Configured multi-stage Dockerfiles and docker-compose configurations.
- Maintained PostgreSQL schemas and optimized database queries.

EDUCATION & CERTIFICATIONS
B.S. in Computer Science - State University (2021)
AWS Certified Cloud Practitioner (2023)
`

export const SAMPLE_GITHUB_URL = 'https://github.com/alexrivera-dev'
export const SAMPLE_TARGET_ROLE = 'Senior Full Stack TypeScript Engineer'
