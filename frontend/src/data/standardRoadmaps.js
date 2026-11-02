/**
 * Curated, read-only summaries of the public roadmap.sh learning paths
 * (github.com/kamranahmedse/developer-roadmap, roadmaps/<slug>/content).
 *
 * Bundled statically so the Learnings page never depends on the network at runtime.
 * Reference material only: unrelated to the tracked roadmaps in src/lib/roadmap.js.
 */

export const STANDARD_ROADMAPS = {
  // roadmap.sh/react
  react: [
    { id: 'react-components', label: 'JSX, components, and props vs state' },
    { id: 'react-rendering', label: 'Rendering: conditional rendering, lists and keys, events' },
    { id: 'react-hooks', label: 'Hooks: useState, useEffect, and custom hooks' },
    { id: 'react-routing-state', label: 'Routing and state management' },
    { id: 'react-api-forms', label: 'API calls and forms' },
    { id: 'react-testing', label: 'Testing with Vitest or Jest, React Testing Library, and Playwright' },
  ],
  // roadmap.sh/typescript
  typescript: [
    { id: 'ts-intro', label: 'TypeScript vs JavaScript, installation, and tsconfig.json' },
    { id: 'ts-types', label: 'Core types, type inference, and combining types' },
    { id: 'ts-interfaces-classes', label: 'Interfaces, classes, and typed functions' },
    { id: 'ts-generics', label: 'Generics and generic constraints' },
    { id: 'ts-advanced', label: 'Narrowing, utility types, and advanced types' },
    { id: 'ts-ecosystem', label: 'Modules and ecosystem: build tools, linting, and formatting' },
  ],
  // roadmap.sh/api-design
  'rest apis': [
    { id: 'rest-http', label: 'HTTP basics: methods, status codes, and headers' },
    { id: 'rest-principles', label: 'REST principles and resource modeling' },
    { id: 'rest-conventions', label: 'Naming conventions, pagination, filtering, and versioning' },
    { id: 'rest-auth', label: 'Authentication and authorization: JWT, OAuth 2.0, and RBAC' },
    { id: 'rest-performance', label: 'Rate limiting, caching, and API performance' },
    { id: 'rest-docs-testing', label: 'API documentation and testing' },
  ],
  // roadmap.sh/qa
  testing: [
    { id: 'testing-fundamentals', label: 'Testing fundamentals and the QA mindset' },
    { id: 'testing-manual', label: 'Manual testing: functional, regression, and exploratory' },
    { id: 'testing-frontend', label: 'Frontend automation with Cypress or Playwright' },
    { id: 'testing-backend', label: 'Backend automation and API testing' },
    { id: 'testing-nonfunctional', label: 'Non-functional testing: load, performance, and accessibility' },
    { id: 'testing-ci', label: 'CI/CD integration and test reporting' },
  ],
  // roadmap.sh/docker
  docker: [
    { id: 'docker-intro', label: 'Why containers, and underlying tech: namespaces, cgroups, union filesystems' },
    { id: 'docker-cli', label: 'Installation, the Docker CLI, and third-party images' },
    { id: 'docker-persistence', label: 'Data persistence: volumes and bind mounts' },
    { id: 'docker-images', label: 'Building images: Dockerfiles, layer caching, and image size' },
    { id: 'docker-compose', label: 'Networks, Docker Compose, and container registries' },
    { id: 'docker-deploy', label: 'Container security and deploying containers' },
  ],
  // roadmap.sh/system-design
  'system design': [
    { id: 'sd-approach', label: 'How to approach system design, and core trade-offs' },
    { id: 'sd-cap', label: 'Availability vs consistency and the CAP theorem' },
    { id: 'sd-traffic', label: 'DNS, CDNs, load balancing, and horizontal scaling' },
    { id: 'sd-data', label: 'Databases and caching strategies' },
    { id: 'sd-async', label: 'Asynchronism and communication: queues, background jobs, HTTP, gRPC' },
    { id: 'sd-patterns', label: 'Cloud design patterns and health monitoring' },
  ],
  // roadmap.sh/git-github
  'git workflow': [
    { id: 'git-basics', label: 'Git basics: init, committing changes, and commit messages' },
    { id: 'git-branching', label: 'Branching basics and merging strategies' },
    { id: 'git-remotes', label: 'Remotes, cloning, and forking' },
    { id: 'git-collaboration', label: 'Collaboration on GitHub: pull requests and code reviews' },
    { id: 'git-history', label: 'Managing history: rebase, reset, revert, and stash' },
    { id: 'git-automation', label: 'Automation with Git hooks and GitHub Actions' },
  ],
  // roadmap.sh/kubernetes
  kubernetes: [
    { id: 'k8s-concepts', label: 'Overview, key concepts, and a local cluster' },
    { id: 'k8s-workloads', label: 'Running applications: Pods, ReplicaSets, and Deployments' },
    { id: 'k8s-networking', label: 'Services, networking, and external access' },
    { id: 'k8s-config', label: 'ConfigMaps, resource requests and limits, and quotas' },
    { id: 'k8s-operations', label: 'Security with RBAC, plus monitoring and logging' },
    { id: 'k8s-scaling', label: 'Autoscaling and rolling, canary, and blue-green deployments' },
  ],
  // roadmap.sh/postgresql-dba
  postgresql: [
    { id: 'pg-concepts', label: 'Relational concepts: object model, ACID, and MVCC' },
    { id: 'pg-setup', label: 'Installation and connecting with psql' },
    { id: 'pg-sql', label: 'Learn SQL: filtering, joins, modifying data, and CTEs' },
    { id: 'pg-admin', label: 'Configuration, authentication models, and privileges' },
    { id: 'pg-reliability', label: 'Backups and replication' },
    { id: 'pg-tuning', label: 'Indexes and query analysis with EXPLAIN' },
  ],
  // roadmap.sh/python
  python: [
    { id: 'py-basics', label: 'Basics: syntax, variables, data types, and control flow' },
    { id: 'py-structures', label: 'Lists, tuples, sets, dictionaries, and core algorithms' },
    { id: 'py-oop', label: 'Modules, exceptions, and object-oriented programming' },
    { id: 'py-advanced', label: 'Decorators, iterators, regular expressions, and concurrency' },
    { id: 'py-packaging', label: 'Package managers and virtual environments' },
    { id: 'py-ecosystem', label: 'A web framework, static typing, and testing with pytest' },
  ],
  // roadmap.sh/aws
  aws: [
    { id: 'aws-intro', label: 'Cloud fundamentals and AWS global infrastructure' },
    { id: 'aws-iam', label: 'IAM: users, roles, and policies' },
    { id: 'aws-compute-network', label: 'EC2 and VPC networking' },
    { id: 'aws-storage', label: 'S3 storage and object lifecycle' },
    { id: 'aws-data', label: 'Managed data: RDS, DynamoDB, and ElastiCache' },
    { id: 'aws-serverless', label: 'Lambda, containers with ECS or EKS, and CloudWatch' },
  ],
  // roadmap.sh/javascript
  javascript: [
    { id: 'js-basics', label: 'Introduction, variables, and data types' },
    { id: 'js-control-flow', label: 'Operators, control flow, and loops' },
    { id: 'js-functions', label: 'Functions, scope, and closures' },
    { id: 'js-objects', label: 'Objects, classes, and the this keyword' },
    { id: 'js-async', label: 'Asynchronous JavaScript: event loop, callbacks, promises, and async/await' },
    { id: 'js-platform', label: 'Modules, DOM APIs, debugging, and memory management' },
  ],
  // roadmap.sh/nodejs
  'node.js': [
    { id: 'node-intro', label: 'Introduction, running Node.js code, and Node.js vs the browser' },
    { id: 'node-modules', label: 'Modules: CommonJS, ESM, npm, and creating packages' },
    { id: 'node-async', label: 'Async programming: event loop, promises, async/await, and error handling' },
    { id: 'node-core', label: 'Working with files, streams, and command-line apps' },
    { id: 'node-apis-data', label: 'Building APIs with Express or Fastify, and working with databases' },
    { id: 'node-production', label: 'Testing, logging, debugging, and scaling with threads and clusters' },
  ],
  // roadmap.sh/datastructures-and-algorithms
  'data structures & algorithms': [
    { id: 'dsa-fundamentals', label: 'Pick a language and learn programming fundamentals' },
    { id: 'dsa-basic-structures', label: 'Basic data structures: arrays, linked lists, stacks, queues, and hash tables' },
    { id: 'dsa-complexity', label: 'Algorithmic complexity: time vs space and Big-O notation' },
    { id: 'dsa-sort-search', label: 'Sorting and search algorithms, including recursion' },
    { id: 'dsa-trees-graphs', label: 'Trees, heaps, graphs, and traversal with BFS and DFS' },
    { id: 'dsa-techniques', label: 'Problem-solving techniques: two pointers, sliding window, greedy, and dynamic programming' },
  ],
}

export const GENERIC_ROADMAP = [
  { id: 'generic-fundamentals', label: 'Learn the fundamentals' },
  { id: 'generic-project', label: 'Build a small project' },
  { id: 'generic-patterns', label: 'Study common patterns and best practices' },
  { id: 'generic-codebases', label: 'Review real-world codebases' },
]

/**
 * Case-insensitive lookup that never throws. Unknown or non-string input
 * (null, undefined, empty string) returns GENERIC_ROADMAP.
 *
 * @param {string} skillName
 * @returns {Array<{id: string, label: string}>}
 */
export function getStandardRoadmap(skillName) {
  if (typeof skillName !== 'string') return GENERIC_ROADMAP
  const key = skillName.trim().toLowerCase()
  // hasOwn keeps inherited names such as "constructor" from matching
  return Object.hasOwn(STANDARD_ROADMAPS, key) ? STANDARD_ROADMAPS[key] : GENERIC_ROADMAP
}
