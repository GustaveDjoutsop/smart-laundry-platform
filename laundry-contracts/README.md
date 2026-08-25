# laundry-contracts

Shared request/response DTOs for the `PaymentManagementService` ↔ `MachineStateService`
↔ `spring-bot-manager-only` handshakes (Implementation Roadmap R8).

## Why this module exists

`bot-laundry/MachineService.java` and PaymentManagementService's `MachineStartService.java`
each independently hand-built the same `POST /api/machines/start-cycle` payload as an
untyped `Map<String, Object>`. Every service publishes an OpenAPI spec, but nothing
enforced agreement between them — a field rename or a typo on either side would only
surface at runtime, as a 400 or a silently-ignored field.

This module is the single source of truth for the handful of DTOs that cross a service
boundary. It does **not** replace each service's internal domain model — MSS's JPA-backed
`Reservation` entity, PMS's `Transaction` entity, and this module's `ReservationResponse` /
`TransactionStatus` are deliberately different types. Each service maps between its
internal model and these contracts at the controller/client boundary.

## What's in it

| Type | Used by |
|---|---|
| `machine.MachineStartRequest` | `POST /api/machines/start-cycle` request |
| `reservation.ReservationRequest` | `POST /api/reservations` request |
| `reservation.ReservationResponse` | Every reservation endpoint's response |
| `reservation.ReservationStatus` | Wire-level mirror of MSS's internal enum |
| `payment.PaymentInitiateRequest` | `POST /api/payments/initiate` request |
| `payment.TransactionStatus` | `GET /api/payments/transaction/{reference}` response — a slim projection, not the full `Transaction` JPA entity that endpoint previously returned |
| `payment.PaymentProvider` | Wire-level mirror of PMS's internal enum |
| `payment.PaymentStatus` | Wire-level mirror of PMS's internal enum |

All request/response types are Java **records**. The two "wire-level mirror" enums exist
so this module stays dependency-free of any service's persistence model — see the
Dependencies section.

## Dependencies

Deliberately minimal: `jakarta.validation-api` only, pinned to exactly the version
`spring-boot-starter-parent:3.5.14` resolves (verified against
`PaymentManagementService`'s dependency tree). No Spring, no Jackson, no Lombok. Records
get `equals`/`hashCode`/`toString`/accessors for free from the language; Jackson's
built-in record support (2.12+) serializes them with no extra annotations needed.

## Versioning

Semantic versioning starting at `0.1.0`. **Consumers must depend on an explicit version,
never `LATEST`** — a floating version defeats the entire point of a shared contract
(a consumer could silently pick up a breaking change on its next build). Bump the
version in `pom.xml`, merge, then push a `laundry-contracts-vX.Y.Z` tag matching it to
publish (see below) — the tag-version check in the publish workflow fails loudly if
they don't match.

## Publishing (GitHub Packages)

No internal artifact repository — this repo doesn't need new infrastructure for one
shared library, and GitHub Packages is free here. Two workflows:

- `.github/workflows/laundry-contracts.yml` — build, test, and Checkstyle on every push/PR
  touching `laundry-contracts/**`.
- `.github/workflows/laundry-contracts-publish.yml` — publishes to GitHub Packages, but
  **only** on a `laundry-contracts-v*` tag push (or manual `workflow_dispatch`). A fixed
  release version can only be published once; gating that on every branch push would
  break CI on the very next no-version-bump commit.

To cut a release:

```bash
# after bumping <version>0.2.0</version> in pom.xml and merging
git tag laundry-contracts-v0.2.0
git push origin laundry-contracts-v0.2.0
```

## Consuming it from another service

GitHub Packages' Maven registry requires authentication for **every** request, including
read-only downloads of packages in a public repo — there is no anonymous-read option, unlike
GitHub Packages' npm registry. Every consuming service's CI and every developer's local
Maven both need a token with `read:packages` scope.

1. Add the dependency, **pinned to an explicit version**:
   ```xml
   <dependency>
       <groupId>com.smartlaundromat</groupId>
       <artifactId>laundry-contracts</artifactId>
       <version>0.1.0</version>
   </dependency>
   ```
2. Add the repository:
   ```xml
   <repositories>
       <repository>
           <id>github</id>
           <url>https://maven.pkg.github.com/GustaveDjoutsop/smart-laundry-platform</url>
       </repository>
   </repositories>
   ```
3. **CI (GitHub Actions):** add `server-id: github` to that job's `actions/setup-java` step
   (auto-generates `~/.m2/settings.xml`) and pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
   as an env var on the Maven step — the built-in `GITHUB_TOKEN` already has `packages:read`
   on this repo, no new secret needed.
4. **Local development:** add a `<server>` block to `~/.m2/settings.xml` with a personal
   access token (classic, `read:packages` scope) as the password — a one-time per-machine
   setup, same shape as any other private Maven registry.
