# Frontend Requirements and Developer Handoff

**Project:** Intelligent Infrastructure Automation Platform  
**Architecture reference:** [README.md](README.md)  
**Audience:** Frontend developer building the initial user-facing platform console

## 1. Objective

Build a web interface that lets a developer with little or no DevOps knowledge:

1. Register and sign in.
2. Register an application using its source repository and minimal configuration.
3. Request a build and follow its progress.
4. Follow the backend's automatic handoff from a successful build to deployment.
5. Open and copy the application's public URL when its deployment is ready.
6. Inspect previous builds and deployments, understand failures, and update application configuration.

The frontend is a platform console, not a Jenkins dashboard or Kubernetes administration tool. Users should not need to understand containers, registries, namespaces, or cluster credentials to complete the primary journey.

### Specification Status

- The service boundaries and asynchronous workflow come from `README.md`.
- This document proposes the frontend MVP. The architecture does not yet define frontend technology, exact API endpoints, payloads, validation rules, or status codes.
- Routes, field names, and status labels below are frontend proposals, not existing backend contracts.
- Application Service now has a concrete Node.js implementation. Use [its API and integration contract](app%20service.md) for application CRUD, build requests/history, pagination, errors, and authentication; other services' capabilities below still require agreement with their developers.
- Start implementation with replaceable API mocks. Confirm contracts with the backend developers before live integration.

## 2. Scope and Priorities

### Required for the MVP

| Area | Required functionality |
|---|---|
| Authentication | Registration, login, logout, protected routes, and expired-session handling |
| Dashboard | Owned applications, recent activity where available, and a clear create-application action |
| Applications | List, create, view, and edit an application's supported configuration |
| Builds | Request a build through Application Service; display build history, progress, outcome, and failure details |
| Deployments | Display automatic deployment progress, history, current deployment, and its public URL |
| Feedback | Loading, empty, validation, permission, unavailable-service, and unknown/stale status states |
| Shared UI | Responsive navigation, forms, status indicators, confirmations, and notifications |
| Integration foundation | Central API client, authentication handling, mocks, and tests for the primary flows |

### Backend-Dependent Controls

Prepare UI designs for these features, but only enable them when the relevant backend contract exists:

- Build logs and deployment diagnostics exposed by the owning service.
- Redeploying an existing successful build without rebuilding its source.
- Stopping, resuming, or tearing down a deployment.
- Deleting an application after the backend defines what happens to its workloads and history.
- Password reset, password change, and editable account information.
- Additional configuration such as branch, repository subdirectory, build/start commands, or application port.

Do not present a nonfunctional button as a supported action. Omit unavailable controls or clearly label them as unavailable without suggesting that they work.

### Not Part of the Initial Frontend

- Billing, subscriptions, teams, organization roles, or an administrator console.
- Git-provider OAuth connections and private-repository credential management unless separately agreed.
- A secrets/environment-variable management interface until its storage and access contract is defined.
- Custom domains, DNS management, or certificate administration.
- Cluster selection, Kubernetes YAML editors, pod terminals, or direct infrastructure consoles.
- CPU/memory charts, uptime monitoring, autoscaling controls, rollback, build cancellation, or deployment approvals without explicit backend support.
- Email/webhook notification management or a large marketing website.

## 3. Navigation and Proposed UI Routes

These are browser routes, not REST API endpoints. Resource identifiers are opaque IDs supplied by the backend.

| Route | Screen |
|---|---|
| `/` | Redirect to dashboard or login based on session state |
| `/register` | Create an account |
| `/login` | Sign in |
| `/dashboard` | Account overview and recent application activity |
| `/applications` | Owned application list |
| `/applications/new` | Create application form |
| `/applications/:applicationId` | Application overview |
| `/applications/:applicationId/builds` | Application build history |
| `/applications/:applicationId/builds/:buildId` | Build details and available logs |
| `/applications/:applicationId/deployments` | Current deployment and deployment history |
| `/applications/:applicationId/deployments/:deploymentId` | Deployment details |
| `/applications/:applicationId/settings` | Edit supported application configuration |

Use an authenticated application shell with primary navigation for Dashboard and Applications, an account/logout menu, and breadcrumbs inside an application. On mobile, use compact navigation. Application pages should share Overview, Builds, Deployments, and Settings tabs.

Direct links and page reloads must work. Configure the frontend host to serve the application entry point for valid client-side routes. Include a not-found page and appropriate forbidden/resource-not-found states.

## 4. Screen Requirements

### 4.1 Registration and Login

- Proposed registration fields: email, password, and confirm password. Add a name only if the Auth Service accepts it; confirm the actual login identifier with the backend.
- Confirm password is a client-side check and should not be sent unless the API explicitly requires it.
- Use labels, password visibility controls, appropriate autocomplete attributes, and inline validation.
- Match password and identifier rules to the Auth Service; do not invent requirements that conflict with it.
- Show submission progress and prevent repeated submissions while a request is pending.
- Explain invalid credentials without revealing whether a particular account exists.
- Do not assume registration automatically signs the user in. Follow the Auth Service response, including any verification requirement.
- Redirect after login to the dashboard or a validated same-origin internal return path.
- Logout clears local session data and user-specific caches and stops authenticated polling. It must not stop backend builds or deployed applications.

### 4.2 Dashboard and Application List

- Show only applications returned for the authenticated user. The backend must enforce ownership.
- Provide a prominent **Create application** action and a useful first-use empty state.
- Each application item shows its name, runtime, repository, latest build status, and current deployment status when those values are available.
- Show the public URL when the Deployment Service supplies it, with open and copy actions.
- Include a recent-activity section if the APIs provide activity or enough build/deployment history to derive it reliably.
- Summary counts must come from complete data or backend totals. Do not calculate account-wide counts from one paginated page.
- Support pagination for growing lists. Search, filtering, and sorting must match API capabilities; clearly limit client-side search to loaded items when necessary.
- Keep usable application data visible if Build or Deployment Service is temporarily unavailable. Mark the affected status as unavailable or stale rather than failing the entire page.

### 4.3 Create Application

| Field | MVP expectation |
|---|---|
| Application name | Required, human-readable name; backend defines length and uniqueness rules |
| Source repository | Required repository location in a backend-supported format; use URL-format validation for URL-based input |
| Runtime | Required selection from Django, Flask, Node.js, and React, subject to backend availability |
| Branch/reference | Optional only if supported; use the repository/backend default instead of hardcoding `main` or `master` |
| Additional configuration | Only fields accepted by Application Service; keep advanced options collapsed and explain them |

- Use brief help text and examples appropriate for a developer unfamiliar with deployment tooling.
- Do not clone repositories, verify repository access, or detect runtimes directly from the browser. Those checks belong to the backend.
- Do not request Jenkins, Docker Hub, or Kubernetes credentials. Reject credential-bearing repository URLs and do not encourage embedding access tokens in them.
- Use **Create application** as the initial submit action, then navigate to the saved application's overview.
- The overview provides **Build & deploy**, described as building the source and allowing the backend to deploy the resulting image automatically.
- If a combined create-and-build action is later added, handle partial success: a saved application remains saved even if the build request fails. Do not recreate it during recovery.

### 4.4 Application Overview

Display application identity and configuration alongside two separate operational summaries:

| Summary | Contents |
|---|---|
| Latest build attempt | Build ID, requested source/reference, status, timestamps, and safe failure details |
| Current deployment | Deployment ID, associated build/image, status, last update, and public URL |

- Include a stage tracker: **Configured -> Building -> Deploying -> Ready**. Show queued and failed states within the appropriate stage.
- Derive the tracker from backend records. A completed build alone does not mean the application is live.
- A failed new build or deployment must not overwrite the display of a previously running deployment.
- Provide **Build & deploy**, links to build/deployment details, and **Open application** when a backend-confirmed ready deployment has a URL.
- Show pending actions, last-updated time, and useful next steps when a stage fails.
- Configuration edits and new build requests must not imply that the currently running application has already changed.

### 4.5 Build History and Details

- List builds newest first using backend timestamps/order, with status, creation time, duration where derivable, and source reference/commit if supplied.
- Display the selected build's identifier, application, runtime/configuration snapshot if supplied, timestamps, image reference on success, and safe failure reason.
- Acknowledge a build as queued only after the backend confirms acceptance and provides its identifier. Do not keep the submission request open until the build finishes.
- Keep source-to-image progress separate from deployment progress. Show stage-level detail only when the API actually supplies it.
- Offer **Start a new build** after a failure when supported. A user-requested new build is distinct from an automatic worker retry.
- If logs are available, fetch them through Build Service via the API Gateway, never directly from Jenkins.
- Render logs as escaped plain text, preserve formatting, bound large output, and avoid forced scrolling when the user is reading earlier lines.
- Distinguish no logs yet, logs unavailable, and an actual empty completed log. Do not make live streaming or downloads mandatory without API support.

### 4.6 Deployment History and Details

- Show the current deployment separately from historical deployment attempts.
- Show deployment ID, associated application/build ID, image reference, status, timestamps, safe failure details, and returned public URL.
- Read current/active deployment identity from the backend. Do not assume that the newest attempt, or the last response to arrive, is the live version.
- Track automatic deployment after build success. If the build is complete but no matching deployment is visible yet, show **Waiting for deployment** and recheck.
- Do not create a deployment from a browser effect or build-completion callback. Build Service owns the automatic handoff to Deployment Service.
- Do not construct a public hostname from the application name. Display the URL supplied by Deployment Service and validate its allowed `http`/`https` scheme before linking.
- Open user applications as external links, never with platform authentication headers or tokens. Do not embed tenant applications inside the console.
- If supported, redeploy through Deployment Service using the agreed build/deployment reference; do not rebuild by default.
- Stopping or tearing down a workload requires confirmation that names the application and explains the service interruption. Distinguish stopping a workload from deleting its application record.
- Deployment readiness is the backend-reported condition, not proof of continuous uptime. Do not present an uptime/health guarantee without a monitoring contract.

### 4.7 Application Settings

- Populate the form from Application Service and allow editing only supported fields.
- Provide save progress, field errors, successful-save feedback, and protection against accidentally discarding unsaved changes.
- Explain whether changes affect the next build or initiate another action once that behavior is defined by the backend.
- Do not silently trigger a build/deployment on save unless that is an explicit, documented API behavior.
- Gate deletion behind a defined backend lifecycle contract and destructive-action confirmation. Do not implement cross-service cleanup in the browser.

## 5. Required User Journeys

### First Deployment

```text
Register -> Login -> Create application -> Application overview
-> Build & deploy -> Build queued -> Build running -> Image ready
-> Backend creates deployment -> Deployment in progress -> Ready -> Open public URL
```

The user can close the browser and return later. Reopening the application reconstructs progress from the backend, without restarting work.

### Build Failure

```text
Build requested -> Build failed -> Read reason/available logs
-> Correct source or supported configuration -> Start a new build
```

Do not show deployment success for the failed build. Preserve any previous live deployment.

### Deployment Failure

```text
Build succeeded -> Deployment failed -> Inspect deployment reason
-> Use a supported recovery action or follow the suggested next step
```

Do not automatically rebuild an already successful image. A deployment retry, if offered, must use the agreed Deployment Service action.

### Update an Existing Application

```text
Open existing application -> Edit supported configuration or update repository source
-> Request new build -> Track new build/deployment attempt -> Backend confirms current version
```

Keep the previous deployment identifiable throughout the update; the backend determines rollout and availability behavior.

### Expired Session or Partial Outage

- On unrecoverable authentication expiry, stop private requests and return to login with a safe return path.
- A management-service outage shows an unavailable/stale section, not an assertion that the user's deployed application has stopped.
- Browser navigation, logout, and connection loss do not cancel accepted backend work.

## 6. Status and Asynchronous Behavior

### Proposed Display States

Map these concepts to the actual backend enums. Do not assume the labels are literal API values or that the backend supports every intermediate stage.

| Domain | Display states |
|---|---|
| Application configuration | Loading, not configured, configured, unavailable |
| Build attempt | Not started, queued, in progress, succeeded, failed |
| Build-to-deployment handoff | Waiting for deployment |
| Deployment attempt | Not started, queued, deploying, ready, failed |
| Supported lifecycle actions | Stopping, stopped, removing, removed, only if defined by the backend |
| Any resource status | Unknown or last known status with a stale/unavailable indicator |

- Use text and icons as well as color. Distinguish request submission from accepted/queued work.
- Use indeterminate progress when the backend supplies no measurable progress. Never invent percentages, queue positions, or completion estimates.
- For the MVP, use polling rather than assuming WebSockets or server-sent events exist.
- Proposed polling baseline: every 3-5 seconds for an active viewed build/deployment, configurable with backoff and respect for `Retry-After`.
- Avoid overlapping requests. Pause when offline or hidden, clean up on navigation/logout, and revalidate when the page becomes visible again.
- Stop active-job polling at backend-confirmed terminal states. Revalidate related history, application summaries, and current deployment after transitions.
- A successful build still needs a matching deployment outcome; do not stop all tracking at build completion.
- Terminal ready does not imply permanent health. Refresh current deployment status on revisit/focus or manual refresh; continuous monitoring is a separate capability.
- Fetch paginated history on demand instead of polling every historical record. Prefer backend summaries/bulk reads over one build and deployment request per application card.
- Unknown status values must render safely. Do not treat them as success; use conservative refresh/backoff or manual refresh until their meaning is agreed.
- Keep last-known data with a last-updated indicator during failures. Do not turn network errors into build/deployment failures.
- Prevent duplicate clicks while submissions are pending. Do not automatically retry create/build/redeploy requests after ambiguous timeouts unless the backend provides a defined idempotency/reconciliation mechanism.

## 7. API Integration and Data Expectations

All browser API requests go through one configurable **API Gateway base URL**. Auth, Application, Build, and Deployment Service remain the domain owners behind that gateway.

```text
Browser -> API Gateway -> Owning service
Application Service -> Build Service -> Worker/Jenkins
Build Service -> Deployment Service -> Worker/Kubernetes
```

The browser requests actions and observes results. It does not orchestrate Celery tasks, image pushes, or Kubernetes provisioning.

The following are contract needs, not endpoint definitions or finalized schemas:

| Owner | Capability needed | Data needed by the UI |
|---|---|---|
| Auth Service | Register/login | Accepted credential fields, account outcome, session/token information, validation errors |
| Auth Service | Refresh/logout, as supported | Expiry/refresh behavior and logout semantics |
| Auth Service | Current identity, if exposed | User ID and display identity; fetch for session initialization, not token validation before every API request |
| Application Service | List/read applications | Application ID, name, repository, runtime, accepted configuration, timestamps, pagination |
| Application Service | Create/update application | Saved application record and structured validation/conflict errors |
| Application Service | Request a build | Acceptance outcome and build ID, or a clear rejection |
| Build Service | List/read builds | Build ID, application ID, source reference, status, timestamps, result/image reference, safe failure details |
| Build Service | Read logs, if supported | Sanitized text/chunks, pagination/cursor if needed, and completion/availability information |
| Deployment Service | List/read deployments | Deployment ID, application/build references, status, timestamps, image reference, safe failure details, public URL |
| Deployment Service | Identify current deployment | Authoritative current/active deployment reference and state |
| Owning service | Optional lifecycle actions | Whether actions are supported/allowed, their accepted result, and the operation/resource to track |

- Preserve identifiers as opaque strings, including cross-service references. Do not invent numeric IDs or infer ownership from them.
- Keep API calls and response mapping out of display components. Adapt agreed backend responses into typed view models.
- Prefer server-authoritative summaries and capability flags where available. Do not introduce an aggregation service solely for the frontend.
- Treat a documented asynchronous acceptance response, such as HTTP `202`, as acceptance rather than completion. Do not require `202` if the final API uses another documented response.
- Use service-specific data independently so one unavailable domain does not erase unrelated data.
- Ask for structured field errors and a safe general error message. Show a request/correlation ID when supplied for support, not stack traces or internal exception details.

### Error Handling

| Condition | Frontend response |
|---|---|
| Validation error, commonly `400` or an agreed `422` | Keep form values and show field/general errors |
| `401` | Attempt the agreed refresh flow; if unrecoverable, clear session and redirect to login |
| `403` | Show a permission error; do not treat it as session expiry |
| `404` | Show an appropriate resource-not-found state without leaking other users' resource details |
| `409` | Explain the conflict, such as an existing active operation, and refresh relevant state |
| `429` | Explain rate limiting and respect retry instructions |
| `5xx`, offline, or read timeout | Show unavailable/stale state with a safe retry action |
| Mutation timeout with unknown outcome | Explain that acceptance is unconfirmed and reconcile through the agreed API before resubmission |

## 8. Authentication and Browser Security

- Auth Service issues JWTs; the gateway/domain services verify them. Frontend route guards and decoded claims are not authorization enforcement.
- Never put JWT signing keys, Jenkins credentials, registry credentials, or cluster credentials in frontend source, build-time variables, mocks, or browser storage.
- Attach bearer tokens only to allowlisted platform API requests when bearer authentication is the agreed contract. Never include tokens in URLs or public-application links.
- Recommended browser session design, subject to backend support: an in-memory access token plus a refresh token in a `Secure`, `HttpOnly` cookie. Confirm cookie scope, `SameSite`, CSRF, and gateway behavior before implementation.
- Do not default to storing long-lived access or refresh tokens in `localStorage`. Session persistence must follow the agreed security contract, not an assumed mechanism.
- Coordinate refresh requests so concurrent API calls do not launch multiple refresh operations. Bound retries and avoid refresh loops. Replaying mutations must follow the backend's explicit safe-retry rules.
- Logout must clear user-specific cached data and use any available server refresh-session invalidation. Do not claim that client logout instantly revokes already-issued stateless access JWTs.
- Mask password input and avoid exposing tokens, credentials, or secrets in diagnostics and analytics.
- Treat repository metadata, error messages, and logs as untrusted text. Do not render them as raw HTML; backend log sanitization/redaction is also required.
- Open external application links with appropriate isolation such as `rel="noopener noreferrer"`. Never forward the console's session to tenant applications.
- Align HTTPS, CORS, cookie scope, and CSRF protection with the gateway. Avoid platform session cookies scoped broadly enough to reach tenant application subdomains.

## 9. UI Quality and Shared Components

Use a clean, coherent console with plain-language status messages. Prefer **Build failed** and **Preparing deployment** over raw worker/job terminology. Technical identifiers and image references belong in expandable details, not the primary onboarding form.

Shared components should cover:

- Application shell, navigation, breadcrumbs, and application tabs.
- Labeled inputs/selects, inline errors, buttons with loading states, and accessible confirmation dialogs.
- Application cards or tables, paginated histories, status badges, and stage tracking.
- Loading placeholders, empty states, retry panels, stale-data indicators, and unobtrusive notifications.
- Read-only technical details, copy-to-clipboard controls, and a bounded plain-text log viewer if supported.

Requirements:

- Support desktop and mobile, including a narrow viewport around 360px. Wide tables/logs may scroll within their containers, not overflow the entire page.
- Support keyboard navigation, visible focus, labeled fields, accessible tabs/dialogs, and status/error announcements.
- Use WCAG AA contrast and do not communicate status through color alone.
- Respect reduced-motion preferences and avoid disruptive notifications on every polling tick.
- Format timestamps consistently with timezone information and derive durations only from valid backend timestamps.
- Include concise empty-state actions such as **Create your first application** and **Start your first build**.
- Do not present fake production metrics, fabricated logs, or hardcoded successful deployment states outside clearly marked mocks.

## 10. Implementation Approach and Mock Data

No frontend stack is selected in the architecture. A reasonable proposed baseline is React + TypeScript with Vite, a router, and a server-state/query library. Follow an agreed team stack instead if one exists; the requirements are framework-independent.

- Separate page/UI components, API access, authentication/session handling, and domain-specific response mapping.
- Configure the gateway base URL per environment. Frontend environment variables are public and must contain no secrets.
- Prefer API-boundary mocks such as MSW or an equivalent approach so switching to real APIs does not require rewriting screens.
- Keep proposed fixture schemas centralized and replace them once backend contracts are agreed.
- Model realistic identifiers and application/build/deployment relationships. Mark mock mode visibly.
- Keep package scripts and local startup/testing instructions clear when the frontend project is added.

Required mock/test scenarios:

- New user with no applications and a successfully deployed application.
- Build queued/in progress, build failed, and successful build waiting for its deployment record.
- Deployment in progress, ready with a URL, and deployment failed.
- Existing ready deployment while a newer build or deployment fails.
- Authentication expiry, forbidden resource, missing resource, invalid form, and conflict response.
- One service unavailable while other sections remain usable; offline/stale data and an unknown status value.
- Ambiguous build-request timeout and repeated clicks without duplicate confirmed operations.
- Reload/navigation during accepted work, long histories, and long logs if supported.

## 11. Suggested Work Order

| Milestone | Frontend developer tasks | Completion check |
|---|---|---|
| 1. Foundation | Initialize agreed stack, routing, application shell, session abstraction, API client, and mocks | Login/register layouts, protected navigation, and loading/error components work in mock mode |
| 2. Application management | Build dashboard, application list, create form, overview, and settings | A user can create/view/edit a mocked owned application and recover from form errors |
| 3. Pipeline visibility | Build history/details, deployment history/details, stage tracking, polling, and URL actions | Complete mocked repo-to-URL journey works, including reloads and independent build/deployment failures |
| 4. Integration and hardening | Replace mocks with agreed APIs, add supported lifecycle controls, verify security, accessibility, and responsive behavior | Integrated happy path and agreed failure scenarios pass without direct infrastructure calls |

The frontend developer can start Milestones 1-3 without waiting for deployed services, using clearly provisional contracts. Milestone 4 requires agreement with the backend team.

## 12. Definition of Done

For the mock milestone, demonstrate the following against fixtures. For integrated MVP completion, verify them against the agreed backend APIs:

- [ ] Registration/login, protected routes, logout, and expired-session behavior work.
- [ ] A user can list, create, view, and edit supported application configuration.
- [ ] A build request shows acceptance promptly and its returned build ID is tracked.
- [ ] Build/deployment progress survives page reloads and navigation without resubmitting work.
- [ ] Backend automatic deployment is observed without a duplicate browser-triggered deployment.
- [ ] A ready deployment displays the returned public URL with working copy/open actions.
- [ ] Failed new attempts do not incorrectly mark a previous running deployment as stopped.
- [ ] Validation, permissions, missing resources, service outages, and ambiguous request outcomes have usable states.
- [ ] Private caches and authenticated polling are cleared on logout or unrecoverable expiry.
- [ ] Desktop/mobile layouts and keyboard/accessibility behavior are verified.
- [ ] Tests cover the successful pipeline, build/deployment failure separation, session expiry, and duplicate-action protection.
- [ ] No infrastructure credentials, raw HTML logs, or direct Jenkins/Kubernetes/registry API calls exist in frontend code.
- [ ] Mock mode and backend-dependent features are clearly identified; unfinished integrations are not represented as working production features.
- [ ] Source code, environment configuration examples without secrets, and run/test instructions are handed over.

## 13. Backend Decisions Needed Before Live Integration

| Decision | Why it matters |
|---|---|
| Auth credential fields, registration outcome, token/session transport, refresh, and logout | Determines forms, session restoration, route guards, and security behavior |
| Gateway URL, API paths/methods, error format, CORS, cookie scope, and CSRF | Enables a correct shared API client |
| Supported repository formats/access, runtimes, and configuration fields/defaults | Prevents exposing inputs the backend cannot use |
| Build acceptance, idempotency, active-operation conflicts, and timeout reconciliation | Prevents duplicate work and incorrect acceptance messages |
| Build/deployment status enums, terminal states, timestamps, and retry reporting | Enables truthful progress mapping and polling |
| Automatic deployment policy and build-to-deployment association | Lets the UI observe the handoff without orchestrating it |
| Current deployment identity and handling of concurrent/out-of-order builds | Prevents showing an old or failed attempt as the live application |
| Deployment readiness and public URL behavior | Determines when to display ready/open actions |
| Log/diagnostic availability, pagination, and redaction | Defines whether and how log views can ship |
| History pagination, summaries, and filtering capabilities | Avoids incomplete dashboard counts and excessive per-application requests |
| Edit, redeploy, stop/resume, teardown, and application deletion semantics | Keeps optional controls and destructive actions consistent with service ownership |

**Handoff instruction:** Start with the mocked core journey and reusable screens. Treat all unconfirmed backend contracts as provisional, keep infrastructure orchestration on the backend, and prioritize a clear application-to-public-URL experience over advanced controls.
