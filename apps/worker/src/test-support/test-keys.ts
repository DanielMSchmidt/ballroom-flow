// ─────────────────────────────────────────────────────────────────────────
// Fixed TEST-ONLY RSA-2048 keypair for networkless Clerk JWT verification.
//
// WHY FIXED (not generated per run): the worker under test (`SELF`) reads its
// env from the vitest-pool-workers/miniflare bindings — a SEPARATE object from
// the test runner's `import { env }`, so a runtime `env.CLERK_JWT_KEY = …`
// mutation never reaches it. The public PEM must therefore be a STATIC binding
// (see vitest.config.ts), which means the signing keypair must be deterministic.
//
// These keys are throwaway fixtures committed for test determinism ONLY. They
// are NEVER used in dev/staging/prod — the real CLERK_JWT_KEY is a Wrangler
// secret (PROVISIONING.md). jwt.ts imports the private key to mint tokens; the
// worker verifies them against the public PEM (= the test CLERK_JWT_KEY).
// ─────────────────────────────────────────────────────────────────────────

/** SPKI public PEM — bound as the worker's test `CLERK_JWT_KEY`. */
export const TEST_JWT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuotPIYxUw/M786JWuF21
uTXQU/Ms1W2/xPbhQMomHib+DyPGr34H9K76tUwdzGvOQ+MKYRicvHH+7b6CNXZo
Jq40ezCeC7HE0ezWay0SjN9IW2G897b+9tx0LoJu5ELj4I7cyO7F6mP8SzYylgQh
SqL3ZYINQ1oAcxmvRqSki0YNqUGqdjlMVoVI1WyB9zPD6mr13DGaZI6osyt3MbC2
KA52WIUJMyi4ZqYEHlY8nQclD4TgQIKACqRA1UZdsuoEv3Aoa4oVT8hnzRqWvFJF
bSVofsrtGOIODLaticiTzdzsc+Q6obpYrayT8FfePj9f++Mc6dcomhCgurn8126N
dQIDAQAB
-----END PUBLIC KEY-----`;

/** PKCS#8 private PEM — jwt.ts imports this to sign test tokens. */
export const TEST_JWT_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6i08hjFTD8zvz
ola4XbW5NdBT8yzVbb/E9uFAyiYeJv4PI8avfgf0rvq1TB3Ma85D4wphGJy8cf7t
voI1dmgmrjR7MJ4LscTR7NZrLRKM30hbYbz3tv723HQugm7kQuPgjtzI7sXqY/xL
NjKWBCFKovdlgg1DWgBzGa9GpKSLRg2pQap2OUxWhUjVbIH3M8PqavXcMZpkjqiz
K3cxsLYoDnZYhQkzKLhmpgQeVjydByUPhOBAgoAKpEDVRl2y6gS/cChrihVPyGfN
Gpa8UkVtJWh+yu0Y4g4Mtq2JyJPN3Oxz5DqhulitrJPwV94+P1/74xzp1yiaEKC6
ufzXbo11AgMBAAECggEAEUq2lBqJBPz4ErZ6qW5uWPPHEvEYt9QLkbt819+lNuhQ
ZqDfWwcov6K0tLeQj5FytlJGdQeuB73dbrZZJZGLSAKf9Mdl7xmUcA0vNxIfhRVx
hJ8DwEajTcjTsDgBBYG50+gKSUnw6LBKA8LLX6KUX3HJ0wwCJLskDYdU+wxqAEre
K1rpIEQ681k7Esu6HHWJHGqtMJCvaxRYIHU6ZCKfvP0/u98hQAQ6zi/39RYN/Dqp
baC/VfBxb9yV2txDD1fhNOymmDgQt/NeVAsZu3u5UgpjKaTuL94mLRCREfa3rd5f
AdPYirfnK5bbMjeA7Edsu2Log6UXhT8gSYRZNfse5QKBgQD8erl5L4G2yIktuN6d
htNy4Eb7EE3bs8WJi0Tub+XMgTKHKPEJtK+bthD6C2ahT5/j9aL89mKnRhRaJ4Vj
xkjgeYerIcPcdr4K8h7VHvAx6cuK4sNMOWV4yh2jnmzhqA/zwxtywst0YEcuP9N9
cijaaTzqP4X8SUh2K/HTLx1I3wKBgQC9JTc4r3ZCF9vkqmfYCr/oc0nhSqbaeH8o
Tv3NQt3Wv00B5BGyPtJUbF3/nvdmR0QKLjqCdxjV7n2KP0IN34bH8+juWuW+z1g5
vEmZIsdji/W7jyGNM8CYU80+kmjmlk/nyLnY/30Tms5VrFufd+t/F1zruHNXc9tx
nuUKP9awKwKBgQC1F9W2/YM9tqLmP6a1OIKr8AAZjn0567zxRgqAN5SNVdIHLi+N
daNLvZB5uPm5FGKr4IEyjgr+zf5FF/nOMegN0j2kWsigdi8jrLy+wr0oH/iVusa4
Aqcst1QBCt4wERq4Dia+7sd9xpznqHIqlVqGJlvB7SROa8XktOp0PmPz4wKBgQCG
R+iHXtInJAchtPTaRO9vmIGn5zbDvW4Q8NtwoPsbXV7Pa9pAYCc0dmbZdkMPoqKk
U6OIQgMoxhLsVfKQJNPsGraQmYmnyE5LVugtRqqlepSvXnMkasxdmIkK1iiRI7+A
v1lpvCBRDcNUwXOeqCVRagW295EzUfZGGNdkSmQhVwKBgHIyU7RqxZcjIBtDEa+1
dHYmUEun4fYcHGJJfFh50pdzbOklnbvYUzrdj8Mz+SmlVLSy+CI13s7RKnX6nI/G
1LhARje3HLVn5CVEGN2lavtEttlbAEuRHdlhR0Z00PxtQA9/2LSWw8gONI7kb8VX
VkOpmkkbzdPCxlKb97x7aS9j
-----END PRIVATE KEY-----`;
