# Coding Rules and Git Conventions

## Java rules

- Disregard Java rules when not using Java
- Don't use interfaces
- Use Lombok annotations whenever possible
- Use ObjectMapper instead of Gson
- For logging use lombok's @Slf4J annotation, and use it in a lazy loading way.
- Do not log full stack traces in exceptions unless it's very critical to and would be the only way to find out what went wrong. In other cases, simply log the error message and if known, the custom reason for why it happened.
- In configuration turn off proxyBeanMethods, and inject the beans in method parameters.
- Use @ControllerAdvice for error handling in controllers.
- Use StringUtils.hasText for null or empty string checks
- Use full, descriptive variable, parameter and method names, instead of shorthands.
- Always prefer imports over using whole import path of classes in the code
- Method ordering in class should start with public methods and end with private methods

### Java empty line rules

- Inside each method add an empty line to separate each logical code block from each other. As an exception do not separate simple things like constructor variable setting code.
- Add an empty line before return statements and other code unless this return statement is the only code inside a code block such as an if block but do not add more than 1 empty line even if other empty line conditions match
- Add an empty line before and after a normal if block unless the next block is part of the if else structure but do not add more than 1 empty line even if other empty line conditions match
- There should be exactly 1 empty line at the end of each file.
- Do not add any empty lines right after an if statement
- Each class level variable should be separated by an empty line but do not add more than 1 empty line even if other empty line conditions match

---

## Java Unit Test Rules

- Name test methods in the following pattern: shouldWhen
- Do not use public modifier for test classes or test methods
- Unit Test code should be separated into logical sections via a comment on its own line for "given", "when" and "then" with an empty line before the when and and then blocks. If the given block is empty, leave it out.
- When testing for exceptions use Throwable thrown = catchThrowable(() -> testedClass.testedMethodCall()); in the // when section and assert it in the // then section
- Use AssertJ assertions
- Avoid boilerplate and repeating test initialization code and and use public final classes with lombok @NoArgsConstructor(access = lombok.AccessLevel.PRIVATE) with static methods for this purpose. Place the final class in a package called testutil under the tested class and name the final class after the test in the format of TestedClassTestUtil
- Prefer running only the impacted unit tests when troubleshooting a certain test or test set over the whole set. At the end always run the whole test set to validate.
- Run the unit tests with parameters that allow you to check the results from a brief summary and to find out if any tests failed and why. If any failed, check the summary and fix the failing tests.
- Use @ParameterizedTest whenever possible instead of repeating similar tests

---

## Robot Framework

- Do not add empty lines between robot code unless it's a very clear logical block to separate
- Place Settings first; import shared Resources/Libraries, then declare Suite Setup/Teardown and Test Setup to centralize environment handling.
- Encapsulate setup/teardown in reusable Keywords; prefer suite-level setup/teardown for sessions and connections, and test-level for per-test state.
- Keep test cases concise: prepare inputs, execute actions, validate outcomes; use brief comments to mark phases (e.g., prepare, act, verify).
- Centralize constants and configuration; reference variables from resource files or environment, avoid hard-coded values in tests.
- Use shared keywords for external calls (HTTP, TCP, file I/O); wrap library calls in resource keywords instead of calling libraries directly in suites.
- Manage context explicitly via suite/test variables; set and update them through dedicated keywords to keep state consistent.
- Prefer named arguments in keyword calls for readability; provide sensible defaults in keyword definitions.
- Handle eventual consistency with retry-oriented keywords and time-bounded waits; avoid arbitrary sleeps unless truly necessary.
- Assert precisely: check statuses, counts, names, sizes and expected responses using focused validation keywords.
- Choose teardown that matches the scenario; ensure sessions are closed, connections disconnected, and transient state cleaned.
- Keep suites high-level and resource files implementation-focused; compose flows from small, well-defined keywords rather than embedding complex logic in tests.
- Document intent with minimal comments tied to business behavior; avoid verbose explanations or implementation details in test bodies.
- Store Python utilities or complex logic behind keywords; keep Robot layers declarative and readable for maintainers and tools.

---

## Commit message rules

- Use the following commit format: `<ticket-id>: <description>`
- ticket id: e.g. jira ticket id DPL-12345 where the id changes based on ticket
- Keep the description concise (under 50 characters)
- Use imperative mood (e.g., "add" not "added" or "adds")
- Don't end with a period
- Use lowercase for the first word unless it's a proper noun
- Provide more details in the commit body if needed, separated by a blank line

---

## 🔗 Branch naming conventions

- Use kebab-case (lowercase with hyphens)
- Follow the pattern: `<type>/<ticket-id>`
- Types: feature, bugfix
- Example: `feature/DPL-12345`

---

## Pull request guidelines

- Provide a clear description of changes
- Ensure all CI checks pass before requesting review
- Keep PRs focused and small when possible
