// =============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: business/.../pop_ladle_abac_role_matrix.csv
// Regenerate: npm run abac:compile
//
// Phase 0 of the RBAC→ABAC migration: the ABAC role matrix as importable
// data + derived capability/attribute vocabulary. Evaluated by nothing yet.
// =============================================================================

export const ABAC_POLICY = {
  "generatedFrom": "pop_ladle_abac_role_matrix.csv",
  "sourceSha256": "7f2697cfccba11b7ad16beb67c438740974f74964000a2c0575a527ba081650c",
  "roleCount": 143,
  "capabilityCount": 300,
  "roles": [
    {
      "roleId": "PL-001-ADM",
      "role": "Global Super Admin",
      "side": "Company",
      "domain": "ADMIN",
      "domainsAtomic": [
        "ADMIN"
      ],
      "whatTheyDo": "Root. Every action logged. Even root cannot publish a recipe that has not cleared the Clinical Review Gate.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T0",
      "tierName": "Root Authority",
      "capabilities": [
        "* (all zones)"
      ],
      "customGrants": [
        "household:delete:any",
        "iam:dual_control_root",
        "config:global"
      ],
      "denies": [],
      "dataScope": "global",
      "phiAccess": "Governed (full, dual-control)",
      "dualControl": "Yes",
      "clinicalGate": "cannot_bypass_clinical_gate"
    },
    {
      "roleId": "PL-002-ADM",
      "role": "Super Admin Manager",
      "side": "Company",
      "domain": "ADMIN",
      "domainsAtomic": [
        "ADMIN"
      ],
      "whatTheyDo": "Manages Super Admin staff & scopes. Cannot self-escalate to root; root settings hidden.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "iam:invite",
        "iam:grant_role",
        "iam:revoke_role",
        "iam:manage_scope",
        "audit:read_global",
        "report:read_operational",
        "monitor:system_health",
        "view"
      ],
      "customGrants": [
        "iam:admin_personnel_manage"
      ],
      "denies": [
        "billing:manage",
        "config:global"
      ],
      "dataScope": "zone:admin-personnel",
      "phiAccess": "None (internal identity only)",
      "dualControl": "Yes (scope grants)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-003-ADM",
      "role": "Product Admin",
      "side": "Company",
      "domain": "ADMIN / PRODUCT",
      "domainsAtomic": [
        "ADMIN",
        "PRODUCT"
      ],
      "whatTheyDo": "Product/feature config only. Staged changes require approval before publish.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "config:product",
        "config:feature_flag",
        "config:schema_defaults",
        "audit:read_scoped",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "config:household_onboarding_defaults"
      ],
      "denies": [
        "clinical_controls",
        "commerce_controls"
      ],
      "dataScope": "zone:product-config",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-004-ADM",
      "role": "Clinical Review Admin",
      "side": "Company",
      "domain": "ADMIN / CLINICAL",
      "domainsAtomic": [
        "ADMIN",
        "CLINICAL"
      ],
      "whatTheyDo": "Governs the gate (config + reviewer assignment). Cannot itself approve a recipe — separation of duties.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "recipe:clinical_gate_configure",
        "recipe:clinical_gate_assign",
        "iam:manage_scope:reviewers",
        "monitor:queue",
        "audit:read_scoped",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "gate:rule_configure",
        "reviewer:assign"
      ],
      "denies": [],
      "dataScope": "zone:clinical-review",
      "phiAccess": "De-identified review context",
      "dualControl": "No",
      "clinicalGate": "governs_gate"
    },
    {
      "roleId": "PL-005-ADM",
      "role": "Recipe Library Admin",
      "side": "Company",
      "domain": "ADMIN / FOOD",
      "domainsAtomic": [
        "ADMIN",
        "FOOD"
      ],
      "whatTheyDo": "Accepts gate-cleared recipes into Master Library. Public publishing toggle is blocked (split from Publishing Admin).",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "library:accept",
        "library:tag",
        "library:lineage_manage",
        "library:quality_review",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [
        "publish:public"
      ],
      "dataScope": "zone:master-library",
      "phiAccess": "None (recipe records)",
      "dualControl": "No",
      "clinicalGate": "downstream_of_gate"
    },
    {
      "roleId": "PL-006-ADM",
      "role": "Taxonomy Admin",
      "side": "Company",
      "domain": "ADMIN / FOOD",
      "domainsAtomic": [
        "ADMIN",
        "FOOD"
      ],
      "whatTheyDo": "Owns global categories, tags, Smart Filtering rules.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "taxonomy:edit",
        "taxonomy:smartfilter",
        "search:index_manage:config",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:taxonomy",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-007-ADM",
      "role": "Publishing Admin",
      "side": "Company",
      "domain": "ADMIN / FOOD",
      "domainsAtomic": [
        "ADMIN",
        "FOOD"
      ],
      "whatTheyDo": "Controls public ship. SoD: must NOT also hold Recipe Library Admin. Can only publish gate-cleared, library-accepted records.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "publish:public",
        "publish:hold",
        "publish:retract",
        "publish:schedule",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "publish:schedule"
      ],
      "denies": [],
      "dataScope": "zone:publishing",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "downstream_of_gate"
    },
    {
      "roleId": "PL-008-ADM",
      "role": "Commerce and Affiliate Admin",
      "side": "Company",
      "domain": "ADMIN",
      "domainsAtomic": [
        "ADMIN"
      ],
      "whatTheyDo": "Retailer routing, product catalog links, affiliate tracking.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "commerce:configure",
        "retailer:route_configure",
        "product_catalog:manage",
        "affiliate:manage",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:commerce",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-009-ADM",
      "role": "Compliance Admin",
      "side": "Company",
      "domain": "ADMIN / COMPLIANCE",
      "domainsAtomic": [
        "ADMIN",
        "COMPLIANCE"
      ],
      "whatTheyDo": "Owns compliance boundary + retention. Changes are dual-control and logged.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "compliance:configure",
        "compliance:boundary_manage",
        "retention:configure",
        "privacy:review",
        "audit:read_global",
        "view"
      ],
      "customGrants": [
        "compliance:boundary_manage",
        "retention:configure"
      ],
      "denies": [],
      "dataScope": "zone:compliance",
      "phiAccess": "Governed (policy, not row-level PHI)",
      "dualControl": "Yes (boundary/retention)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-010-ADM",
      "role": "Model Ops Admin",
      "side": "Company",
      "domain": "ADMIN / ENGINEERING",
      "domainsAtomic": [
        "ADMIN",
        "ENGINEERING"
      ],
      "whatTheyDo": "Runs Care Team Model Route Registry & ChairwomanAI config. Separate API-key boundaries per specialist route.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "model:route_configure",
        "model:run_monitor",
        "model:key_manage",
        "monitor:system_health",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "model:key_manage"
      ],
      "denies": [],
      "dataScope": "zone:model-ops",
      "phiAccess": "None (no PHI in route registry)",
      "dualControl": "Yes (key management)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-011-ADM",
      "role": "Support Admin",
      "side": "Company",
      "domain": "ADMIN / SUPPORT",
      "domainsAtomic": [
        "ADMIN",
        "SUPPORT"
      ],
      "whatTheyDo": "Owns support tooling, escalation paths, support staff access.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "support:ticket_manage",
        "support:account_state",
        "support:escalate",
        "iam:manage_scope:support",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:support",
      "phiAccess": "Scoped (least-necessary, consent/ticket-bound, time-boxed)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-012-ADM",
      "role": "Reporting Admin",
      "side": "Company",
      "domain": "ADMIN / DATA",
      "domainsAtomic": [
        "ADMIN",
        "DATA"
      ],
      "whatTheyDo": "Builds & governs admin reporting across tenants, recipes, ops.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "report:build",
        "report:read_operational",
        "report:read_aggregate",
        "data:catalog_manage:read",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:reporting",
      "phiAccess": "Aggregate / de-identified",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-013-ADM",
      "role": "System Health Admin",
      "side": "Company",
      "domain": "ADMIN / ENGINEERING",
      "domainsAtomic": [
        "ADMIN",
        "ENGINEERING"
      ],
      "whatTheyDo": "Uptime, incident response across layers.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "monitor:system_health",
        "monitor:incident",
        "model:run_monitor:read",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:system-health",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-014-ADM",
      "role": "Audit Admin",
      "side": "Company",
      "domain": "ADMIN / COMPLIANCE",
      "domainsAtomic": [
        "ADMIN",
        "COMPLIANCE"
      ],
      "whatTheyDo": "Owns global audit log. Append-only: can configure & export, CANNOT edit or delete entries.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "audit:read_global",
        "audit:configure",
        "audit:export",
        "retention:configure:audit",
        "view"
      ],
      "customGrants": [
        "audit:configure"
      ],
      "denies": [
        "audit:mutate"
      ],
      "dataScope": "zone:audit",
      "phiAccess": "Metadata (audit records)",
      "dualControl": "Yes",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-015-ADM",
      "role": "Review Queue Admin",
      "side": "Company",
      "domain": "ADMIN",
      "domainsAtomic": [
        "ADMIN"
      ],
      "whatTheyDo": "Balances every review queue so nothing stalls.",
      "surface": "Layer 1 Super Admin Control Plane",
      "layer": "L1",
      "phase": "MVP",
      "tier": "T1",
      "tierName": "Platform Governor",
      "capabilities": [
        "queue:configure",
        "queue:balance",
        "assign",
        "monitor:queue",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "zone:review-queues",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-016-PRD",
      "role": "Product Owner",
      "side": "Company",
      "domain": "PRODUCT",
      "domainsAtomic": [
        "PRODUCT"
      ],
      "whatTheyDo": "Owns product vision & final product decisions. Cannot grant access or touch PHI.",
      "surface": "Internal Product Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "config:product:propose",
        "report:read_operational",
        "assign",
        "approve:work",
        "comment",
        "view"
      ],
      "customGrants": [
        "roadmap:decide"
      ],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-017-PRD",
      "role": "Product Manager",
      "side": "Company",
      "domain": "PRODUCT",
      "domainsAtomic": [
        "PRODUCT"
      ],
      "whatTheyDo": "Turns journeys into specs, runs delivery.",
      "surface": "Internal Product Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "create",
        "edit",
        "assign",
        "comment",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-018-PRD",
      "role": "Product Designer",
      "side": "Company",
      "domain": "PRODUCT / DESIGN",
      "domainsAtomic": [
        "PRODUCT",
        "DESIGN"
      ],
      "whatTheyDo": "End-to-end flows.",
      "surface": "Internal Design Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "edit",
        "comment",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified (consented research only)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-019-PRD",
      "role": "UX Designer",
      "side": "Company",
      "domain": "PRODUCT / DESIGN",
      "domainsAtomic": [
        "PRODUCT",
        "DESIGN"
      ],
      "whatTheyDo": "Owns flows, states, interaction logic.",
      "surface": "Internal Design Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "edit",
        "comment",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-020-PRD",
      "role": "UI Designer",
      "side": "Company",
      "domain": "PRODUCT / DESIGN",
      "domainsAtomic": [
        "PRODUCT",
        "DESIGN"
      ],
      "whatTheyDo": "Visual craft + component library.",
      "surface": "Internal Design Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "content:layout:components",
        "edit",
        "comment",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-021-PRD",
      "role": "UX Researcher",
      "side": "Company",
      "domain": "PRODUCT / RESEARCH",
      "domainsAtomic": [
        "PRODUCT",
        "RESEARCH"
      ],
      "whatTheyDo": "Studies real caregivers. Raw PHI never enters research store.",
      "surface": "Internal Research Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:analyze:research",
        "content:create_draft",
        "comment",
        "view"
      ],
      "customGrants": [
        "research:recruit"
      ],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified (consented research data only)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-022-PRD",
      "role": "Product Marketing Manager",
      "side": "Company",
      "domain": "PRODUCT / MARKETING",
      "domainsAtomic": [
        "PRODUCT",
        "MARKETING"
      ],
      "whatTheyDo": "Health claims CANNOT self-publish — must clear Claims Reviewer + Medical Editor.",
      "surface": "Internal Marketing Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "content:edit",
        "publish:marketing:non_recipe",
        "comment",
        "view"
      ],
      "customGrants": [
        "claims:submit_for_review"
      ],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-023-SUP",
      "role": "Customer Support Lead",
      "side": "Company",
      "domain": "SUPPORT",
      "domainsAtomic": [
        "SUPPORT"
      ],
      "whatTheyDo": "Front-line support lead. PHI access is just-in-time and logged.",
      "surface": "Internal Support Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "support:ticket_manage",
        "support:account_state",
        "support:escalate",
        "assign",
        "report:read_operational",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "support-context",
      "phiAccess": "Scoped (least-necessary, time-boxed, consent-bound)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-024-SUP",
      "role": "Caregiver Success Lead",
      "side": "Company",
      "domain": "SUPPORT",
      "domainsAtomic": [
        "SUPPORT"
      ],
      "whatTheyDo": "Reduces caregiver drop-off after setup.",
      "surface": "Internal Support Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "success:outreach",
        "support:ticket_manage:read",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "support-context",
      "phiAccess": "Scoped / aggregate (consented)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-025-ENG",
      "role": "Engineering Lead",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Leads delivery & technical health. No standing prod PHI.",
      "surface": "Internal Engineering Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "deploy:approve",
        "config:infra",
        "assign",
        "grant:team:repo_env",
        "monitor:system_health",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "breakglass:request"
      ],
      "denies": [],
      "dataScope": "internal-noPHI + infra",
      "phiAccess": "None (prod PHI = break-glass dual-control)",
      "dualControl": "Yes (prod deploy)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-026-ENG",
      "role": "Tech Lead",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Squad technical direction.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "deploy:approve:squad",
        "code:merge_approve",
        "assign",
        "monitor",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-027-ENG",
      "role": "Front-End Engineer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Web surfaces caregivers touch.",
      "surface": "Internal Engineering Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "code:write",
        "code:pr",
        "deploy:request",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI + staging",
      "phiAccess": "None (no prod PHI)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-028-ENG",
      "role": "Back-End Engineer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Builds tenant boundaries & permission enforcement. No standing prod PHI access.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "code:write",
        "code:pr",
        "deploy:request",
        "service:config:non_prod",
        "view"
      ],
      "customGrants": [
        "permission_engine:implement"
      ],
      "denies": [],
      "dataScope": "internal-noPHI + staging",
      "phiAccess": "None (break-glass only)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-029-ENG",
      "role": "Full-Stack Developer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "API-to-screen features.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "code:write",
        "code:pr",
        "deploy:request",
        "service:config:non_prod",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI + staging",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-030-ENG",
      "role": "Mobile Engineer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "One-handed kitchen mobile app.",
      "surface": "Internal Engineering Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "code:write",
        "code:pr",
        "deploy:request",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI + staging",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-031-ENG",
      "role": "Data Engineer",
      "side": "Company",
      "domain": "ENGINEERING / DATA",
      "domainsAtomic": [
        "ENGINEERING",
        "DATA"
      ],
      "whatTheyDo": "Moves events/logs/catalogs into usable data. Works on tokenized data.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:pipeline_manage",
        "data:catalog_manage",
        "data:export_deid",
        "view"
      ],
      "customGrants": [
        "pii:tokenize_manage"
      ],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified / tokenized (raw PHI tokenized at ingest)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-032-ENG",
      "role": "Search Engineer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Recipe search, filters, OpenSearch feedback loop.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "search:index_manage",
        "feedback:loop_manage",
        "code:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-033-ENG",
      "role": "AI / Model Routing Engineer",
      "side": "Company",
      "domain": "ENGINEERING / AI",
      "domainsAtomic": [
        "ENGINEERING",
        "AI"
      ],
      "whatTheyDo": "Builds Care Team routing + ChairwomanAI synthesis. Cannot weaken or bypass the Clinical Review Gate downstream.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "model:route_configure:build",
        "ai:chairwoman_config:build",
        "model:run_monitor",
        "code:write",
        "view"
      ],
      "customGrants": [
        "model:eval_run"
      ],
      "denies": [],
      "dataScope": "internal-noPHI + model-sandbox",
      "phiAccess": "None (tests use de-identified care context)",
      "dualControl": "No",
      "clinicalGate": "cannot_weaken_gate"
    },
    {
      "roleId": "PL-034-ENG",
      "role": "Security Engineer",
      "side": "Company",
      "domain": "ENGINEERING / SECURITY",
      "domainsAtomic": [
        "ENGINEERING",
        "SECURITY"
      ],
      "whatTheyDo": "Authors security policy, approves break-glass. Separation: approves access, does not grant business roles.",
      "surface": "Internal Engineering Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "security:scan",
        "security:policy_author",
        "iam:review",
        "breakglass:approve",
        "keys:rotate",
        "audit:read_global:read",
        "view"
      ],
      "customGrants": [
        "breakglass:approve",
        "keys:rotate"
      ],
      "denies": [],
      "dataScope": "internal + security",
      "phiAccess": "Metadata",
      "dualControl": "Yes (break-glass, key rotation)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-035-ENG",
      "role": "DevOps Engineer",
      "side": "Company",
      "domain": "ENGINEERING",
      "domainsAtomic": [
        "ENGINEERING"
      ],
      "whatTheyDo": "Infra + deploy. Prod deploy requires second approver.",
      "surface": "Internal Engineering Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "infra:provision",
        "deploy:execute",
        "monitor:system_health",
        "secrets:manage:scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "infra",
      "phiAccess": "None",
      "dualControl": "Yes (prod deploy)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-036-QA",
      "role": "QA Lead",
      "side": "Company",
      "domain": "QA",
      "domainsAtomic": [
        "QA"
      ],
      "whatTheyDo": "Owns test strategy & release sign-off (functional).",
      "surface": "Internal QA Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "qa:plan",
        "qa:signoff",
        "assign",
        "qc:review",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-noPHI + test-data",
      "phiAccess": "Synthetic / de-identified only",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-037-QA",
      "role": "QA Tester",
      "side": "Company",
      "domain": "QA",
      "domainsAtomic": [
        "QA"
      ],
      "whatTheyDo": "Executes test cases.",
      "surface": "Internal QA Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "qa:test",
        "issue:report",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "test-data",
      "phiAccess": "Synthetic only",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-038-QA",
      "role": "QC Reviewer",
      "side": "Company",
      "domain": "QA",
      "domainsAtomic": [
        "QA"
      ],
      "whatTheyDo": "Quality-control gate on content & output.",
      "surface": "Internal QA Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "qc:review",
        "qa:signoff:content",
        "reject:work",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "test-data + content",
      "phiAccess": "Synthetic",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-039-DAT",
      "role": "Data Analyst",
      "side": "Company",
      "domain": "DATA",
      "domainsAtomic": [
        "DATA"
      ],
      "whatTheyDo": "Operational analysis.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:analyze",
        "report:build",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified / aggregate",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-040-DAT",
      "role": "Data Scientist",
      "side": "Company",
      "domain": "DATA",
      "domainsAtomic": [
        "DATA"
      ],
      "whatTheyDo": "Models & features.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:analyze",
        "data:model_train",
        "data:export_deid",
        "view"
      ],
      "customGrants": [
        "model:feature_build"
      ],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-041-DAT",
      "role": "Analytics Engineer",
      "side": "Company",
      "domain": "DATA",
      "domainsAtomic": [
        "DATA"
      ],
      "whatTheyDo": "Analytics pipelines & marts.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:pipeline_manage",
        "data:catalog_manage",
        "report:build",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-042-DAT",
      "role": "Reporting Analyst",
      "side": "Company",
      "domain": "DATA",
      "domainsAtomic": [
        "DATA"
      ],
      "whatTheyDo": "Builds operational reports.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "report:build",
        "report:read_aggregate",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "internal-deid",
      "phiAccess": "Aggregate",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-043-DAT",
      "role": "Taxonomy Data Manager",
      "side": "Company",
      "domain": "DATA / FOOD",
      "domainsAtomic": [
        "DATA",
        "FOOD"
      ],
      "whatTheyDo": "Curates taxonomy data.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "taxonomy:edit:data",
        "data:catalog_manage",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "catalog:taxonomy",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-044-DAT",
      "role": "Nutrition Data Manager",
      "side": "Company",
      "domain": "DATA / CLINICAL",
      "domainsAtomic": [
        "DATA",
        "CLINICAL"
      ],
      "whatTheyDo": "Curates Nutrition / USDA FDC / RxNorm / ICD-10 catalogs.",
      "surface": "Internal Data Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "data:catalog_manage:nutrition",
        "view"
      ],
      "customGrants": [
        "catalog:nutrition_manage"
      ],
      "denies": [],
      "dataScope": "catalog:nutrition",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-045-FOOD",
      "role": "Editor in Chief",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Owns voice & final editorial sign-off. Editorial sign-off is NOT the clinical gate; health claims still need Medical/Clinical Editor + gate.",
      "surface": "Internal Editorial Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "content:edit",
        "publish:editorial_signoff",
        "approve:work",
        "reject:work",
        "assign",
        "view"
      ],
      "customGrants": [
        "editorial:final_signoff"
      ],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "downstream_of_gate"
    },
    {
      "roleId": "PL-046-FOOD",
      "role": "Managing Editor",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Runs pipeline & deadlines.",
      "surface": "Internal Editorial Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "content:edit",
        "content:produce",
        "assign",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-047-FOOD",
      "role": "Creative Director",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Owns visual identity.",
      "surface": "Internal Editorial Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "content:layout:direction",
        "approve:visual",
        "assign",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-048-FOOD",
      "role": "Layout Artist",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Screen + print layout.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:layout",
        "content:produce",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-049-FOOD",
      "role": "Engagement Writer",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Product copy, articles, newsletters.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "content:edit",
        "view"
      ],
      "customGrants": [
        "claims:submit_for_review"
      ],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-050-FOOD",
      "role": "Recipe Editor",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Edits recipes so they cook correctly. Cannot approve the clinical gate.",
      "surface": "Internal Editorial Workspace",
      "layer": "L2/L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "recipe:edit_content",
        "recipe:normalize_review",
        "content:edit",
        "view"
      ],
      "customGrants": [
        "recipe:cookability_verify"
      ],
      "denies": [],
      "dataScope": "editorial + recipe",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "cannot_approve_gate"
    },
    {
      "roleId": "PL-051-FOOD",
      "role": "Food Writer",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Food stories, headnotes.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:create_draft",
        "content:edit",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-052-MED",
      "role": "Medical Writer",
      "side": "Company",
      "domain": "MEDICAL / EDITORIAL",
      "domainsAtomic": [
        "MEDICAL",
        "EDITORIAL"
      ],
      "whatTheyDo": "Plain-language medical education. Must clear Medical Editor verify before ship.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "medical_content:write",
        "content:create_draft",
        "view"
      ],
      "customGrants": [
        "claims:submit_for_review"
      ],
      "denies": [],
      "dataScope": "editorial + medical",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "content_precedes_gate"
    },
    {
      "roleId": "PL-053-CLIN",
      "role": "Clinical Writer",
      "side": "Company",
      "domain": "CLINICAL / EDITORIAL",
      "domainsAtomic": [
        "CLINICAL",
        "EDITORIAL"
      ],
      "whatTheyDo": "Hard-rule explanations & caregiver caveats. Drafts verified by Clinical Editor.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "clinical_content:write",
        "content:create_draft",
        "view:review-context"
      ],
      "customGrants": [
        "hardrule:explain_draft"
      ],
      "denies": [],
      "dataScope": "editorial + clinical-deid",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "content_precedes_gate"
    },
    {
      "roleId": "PL-054-MED",
      "role": "Medical Editor",
      "side": "Company",
      "domain": "MEDICAL / EDITORIAL",
      "domainsAtomic": [
        "MEDICAL",
        "EDITORIAL"
      ],
      "whatTheyDo": "Verifies medical accuracy before ship. Medical-content gate.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "medical_content:edit_verify",
        "approve:medical_accuracy",
        "reject:work",
        "view"
      ],
      "customGrants": [
        "gate:medical_signoff"
      ],
      "denies": [],
      "dataScope": "medical",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "approves_at:medical"
    },
    {
      "roleId": "PL-055-CLIN",
      "role": "Clinical Editor",
      "side": "Company",
      "domain": "CLINICAL / EDITORIAL",
      "domainsAtomic": [
        "CLINICAL",
        "EDITORIAL"
      ],
      "whatTheyDo": "Verifies copy matches care rules. Clinical-copy gate.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "clinical_content:edit_verify",
        "approve:clinical_copy",
        "reject:work",
        "view:review-context"
      ],
      "customGrants": [
        "gate:clinical_copy_signoff"
      ],
      "denies": [],
      "dataScope": "clinical-deid",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "approves_at:clinical_copy"
    },
    {
      "roleId": "PL-056-FOOD",
      "role": "Freelance Recipe Developer",
      "side": "Company",
      "domain": "FOOD",
      "domainsAtomic": [
        "FOOD"
      ],
      "whatTheyDo": "Original recipes on contract. Isolated sandbox, time-boxed, watermarked, NDA-bound.",
      "surface": "Internal Editorial Workspace (Contractor)",
      "layer": "L3",
      "phase": "MVP",
      "tier": "TC",
      "tierName": "Contractor (Sandboxed)",
      "capabilities": [
        "recipe:create_draft",
        "content:create_draft:sandbox",
        "asset:upload",
        "view:assignment"
      ],
      "customGrants": [
        "nda:bound",
        "access:time_boxed",
        "watermark:on"
      ],
      "denies": [],
      "dataScope": "contractor-sandbox",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-057-FOOD",
      "role": "Freelance Food Photographer",
      "side": "Company",
      "domain": "FOOD",
      "domainsAtomic": [
        "FOOD"
      ],
      "whatTheyDo": "Recipe photos to brand standard. Sandbox + watermark + expiry.",
      "surface": "Internal Editorial Workspace (Contractor)",
      "layer": "L3",
      "phase": "MVP",
      "tier": "TC",
      "tierName": "Contractor (Sandboxed)",
      "capabilities": [
        "asset:photo",
        "asset:upload",
        "view:assignment"
      ],
      "customGrants": [
        "nda:bound",
        "access:time_boxed",
        "watermark:on"
      ],
      "denies": [],
      "dataScope": "contractor-sandbox",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-058-FOOD",
      "role": "Content Producer",
      "side": "Company",
      "domain": "FOOD / EDITORIAL",
      "domainsAtomic": [
        "FOOD",
        "EDITORIAL"
      ],
      "whatTheyDo": "Assembles ship-ready content.",
      "surface": "Internal Editorial Workspace",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "content:produce",
        "content:layout",
        "asset:assemble",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "editorial",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-059-CLIN",
      "role": "Clinician Reviewer",
      "side": "Company",
      "domain": "CLINICAL",
      "domainsAtomic": [
        "CLINICAL"
      ],
      "whatTheyDo": "THE Clinical Review Gate. Mandatory before any recipe ships, copies, or publishes. Sees de-identified context only.",
      "surface": "Internal Clinical Review Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "recipe:clinical_gate_approve",
        "recipe:clinical_gate_reject",
        "comment",
        "view:review-context"
      ],
      "customGrants": [
        "gate:approve"
      ],
      "denies": [],
      "dataScope": "review-context",
      "phiAccess": "De-identified care profile + recipe",
      "dualControl": "Yes (high-risk recipes)",
      "clinicalGate": "approves_at:clinical"
    },
    {
      "roleId": "PL-060-CLIN",
      "role": "Clinical Nutritionist",
      "side": "Company",
      "domain": "CLINICAL",
      "domainsAtomic": [
        "CLINICAL"
      ],
      "whatTheyDo": "Nutrition-scope gate approval (sodium/K/P/protein/fluid/texture).",
      "surface": "Internal Clinical Review Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "recipe:clinical_gate_approve",
        "recipe:clinical_gate_reject",
        "comment",
        "view:review-context"
      ],
      "customGrants": [
        "gate:approve:nutrition"
      ],
      "denies": [],
      "dataScope": "review-context",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "approves_at:clinical"
    },
    {
      "roleId": "PL-061-CLIN",
      "role": "Registered Dietitian Nutritionist",
      "side": "Company",
      "domain": "CLINICAL",
      "domainsAtomic": [
        "CLINICAL"
      ],
      "whatTheyDo": "Medical nutrition therapy review at the gate.",
      "surface": "Internal Clinical Review Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "recipe:clinical_gate_approve",
        "recipe:clinical_gate_reject",
        "comment",
        "view:review-context"
      ],
      "customGrants": [
        "gate:approve:mnt"
      ],
      "denies": [],
      "dataScope": "review-context",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "approves_at:clinical"
    },
    {
      "roleId": "PL-062-CLIN",
      "role": "Pharmacist Reviewer",
      "side": "Company",
      "domain": "CLINICAL",
      "domainsAtomic": [
        "CLINICAL"
      ],
      "whatTheyDo": "Drug–nutrient & medication-timing review at the gate.",
      "surface": "Internal Clinical Review Workspace",
      "layer": "L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "recipe:clinical_gate_approve:drug_nutrient",
        "medication:interaction_review",
        "reject:gate",
        "comment",
        "view:review-context"
      ],
      "customGrants": [
        "gate:drug_nutrient_review"
      ],
      "denies": [],
      "dataScope": "review-context",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "approves_at:clinical"
    },
    {
      "roleId": "PL-063-LEG",
      "role": "Legal Reviewer",
      "side": "Company",
      "domain": "LEGAL",
      "domainsAtomic": [
        "LEGAL"
      ],
      "whatTheyDo": "Legal sign-off on claims, terms, content.",
      "surface": "Internal Legal Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "legal:review",
        "approve:legal",
        "reject:work",
        "view"
      ],
      "customGrants": [
        "gate:legal_signoff"
      ],
      "denies": [],
      "dataScope": "internal + legal",
      "phiAccess": "Scoped (matter-bound)",
      "dualControl": "No",
      "clinicalGate": "approves_at:legal"
    },
    {
      "roleId": "PL-064-CMP",
      "role": "Regulatory Compliance Reviewer",
      "side": "Company",
      "domain": "COMPLIANCE",
      "domainsAtomic": [
        "COMPLIANCE"
      ],
      "whatTheyDo": "Regulatory posture & approvals.",
      "surface": "Internal Compliance Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "compliance:review",
        "approve:regulatory",
        "reject:work",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "compliance",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "approves_at:regulatory"
    },
    {
      "roleId": "PL-065-CMP",
      "role": "Privacy Reviewer",
      "side": "Company",
      "domain": "COMPLIANCE / PRIVACY",
      "domainsAtomic": [
        "COMPLIANCE",
        "PRIVACY"
      ],
      "whatTheyDo": "Privacy review + data-subject requests.",
      "surface": "Internal Compliance Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "privacy:review",
        "privacy:dsr_process",
        "approve:privacy",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "dsr:process"
      ],
      "denies": [],
      "dataScope": "privacy",
      "phiAccess": "Governed (DSR handling)",
      "dualControl": "No",
      "clinicalGate": "approves_at:privacy"
    },
    {
      "roleId": "PL-066-CMP",
      "role": "Claims Reviewer",
      "side": "Company",
      "domain": "COMPLIANCE",
      "domainsAtomic": [
        "COMPLIANCE"
      ],
      "whatTheyDo": "Gate for marketing & health claims. Nothing with a health claim ships without this.",
      "surface": "Internal Compliance Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "claims:review",
        "approve:claims",
        "reject:work",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "claims",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "approves_at:claims"
    },
    {
      "roleId": "PL-067-CMP",
      "role": "Safety Reviewer",
      "side": "Company",
      "domain": "COMPLIANCE / SAFETY",
      "domainsAtomic": [
        "COMPLIANCE",
        "SAFETY"
      ],
      "whatTheyDo": "Safety sign-off & escalation to root.",
      "surface": "Internal Compliance Workspace",
      "layer": "L1/L2",
      "phase": "MVP",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "safety:review",
        "safety:escalate",
        "approve:safety",
        "reject:work",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "gate:safety_signoff",
        "escalate:root"
      ],
      "denies": [],
      "dataScope": "safety",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "approves_at:safety"
    },
    {
      "roleId": "PL-068-HH",
      "role": "Household",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "The master tenant boundary. Every person, recipe copy, plan, log, note, permission & audit record belongs to one Household.",
      "surface": "Private Household App",
      "layer": "L3",
      "phase": "MVP",
      "tier": "TEN",
      "tierName": "Tenant Boundary (object)",
      "capabilities": [
        "n/a (tenant boundary object, not a login principal)"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "tenant:self",
      "phiAccess": "Container for all tenant PHI",
      "dualControl": "n/a",
      "clinicalGate": "scopes_gate"
    },
    {
      "roleId": "PL-069-HH",
      "role": "Owner",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "Full governance of one Household incl. billing & deletion. Cannot bypass the gate; generated recipes route to clinical review.",
      "surface": "Private Household App",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T5",
      "tierName": "Tenant Owner",
      "capabilities": [
        "iam:invite",
        "iam:grant_role:household",
        "iam:revoke_role",
        "billing:manage",
        "household:delete",
        "household:settings",
        "care_profile:create",
        "care_profile:edit",
        "hard_rule:edit",
        "medication:edit",
        "diagnosis:edit",
        "recipe:generate",
        "recipe:edit_flavor",
        "recipe:edit_content",
        "recipe:version_manage",
        "copy:recipe",
        "print:recipe",
        "favorite:recipe",
        "planner:manage",
        "dayplan:execute",
        "shopping:manage",
        "commerce:order",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "issue:report",
        "delegation:manage",
        "taxonomy:edit:household",
        "export:tenant",
        "audit:read_scoped:household",
        "view"
      ],
      "customGrants": [
        "billing:owner_of_record",
        "household:delete"
      ],
      "denies": [],
      "dataScope": "tenant:self",
      "phiAccess": "Full (own household)",
      "dualControl": "Yes (household:delete = confirm + restore window)",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-070-HH",
      "role": "Co-Owner",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "Full care & content admin. Read-only billing. Household deletion stays Owner-level.",
      "surface": "Private Household App",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T6",
      "tierName": "Tenant Co-Admin",
      "capabilities": [
        "iam:invite",
        "iam:grant_role:household",
        "care_profile:create",
        "care_profile:edit",
        "hard_rule:edit",
        "medication:edit",
        "diagnosis:edit",
        "recipe:generate",
        "recipe:edit_flavor",
        "recipe:edit_content",
        "recipe:version_manage",
        "copy:recipe",
        "print:recipe",
        "favorite:recipe",
        "planner:manage",
        "dayplan:execute",
        "shopping:manage",
        "commerce:order",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "issue:report",
        "delegation:manage",
        "taxonomy:edit:household",
        "export:tenant",
        "billing:view",
        "view"
      ],
      "customGrants": [],
      "denies": [
        "billing:manage",
        "household:delete",
        "owner_transfer"
      ],
      "dataScope": "tenant:self",
      "phiAccess": "Full (own household)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-071-HH",
      "role": "Caregiver",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "Daily execution. Generates & flavor-adjusts recipes. Cannot delete recipes or administer the account.",
      "surface": "Private Household App",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "create:family_recipe",
        "copy:recipe",
        "print:recipe",
        "favorite:recipe",
        "planner:use",
        "dayplan:execute",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "issue:report",
        "view"
      ],
      "customGrants": [],
      "denies": [
        "recipe:delete",
        "iam:*",
        "billing:*",
        "household:settings",
        "care_profile:edit(beyond acceptance)"
      ],
      "dataScope": "tenant:self",
      "phiAccess": "Scoped (care data needed to cook safely; no billing/admin)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-072-HH",
      "role": "Viewer",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "Read-mostly. Sees original + modified versions, clinical review status & caveats, Master recipes, planned-overs, variations.",
      "surface": "Private Household App",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T8",
      "tierName": "Reader / Viewer",
      "capabilities": [
        "view",
        "favorite:recipe",
        "copy:recipe:allowed",
        "print:recipe:allowed",
        "view:clinical_status",
        "view:versions"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "tenant:self:read",
      "phiAccess": "Read (care-relevant view of one household)",
      "dualControl": "No",
      "clinicalGate": "reads_gate_status"
    },
    {
      "roleId": "PL-073-HH",
      "role": "Care Recipient",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "The person care is about. May be a non-user. Consent & dignity controls; profile drives every safety check.",
      "surface": "Private Household App — Profile Subject",
      "layer": "L3",
      "phase": "MVP",
      "tier": "T9",
      "tierName": "Data Subject",
      "capabilities": [
        "self:view:if_enabled",
        "consent:manage",
        "food_acceptance:self",
        "note:self"
      ],
      "customGrants": [
        "consent:manage"
      ],
      "denies": [],
      "dataScope": "subject:self",
      "phiAccess": "Self only",
      "dualControl": "No",
      "clinicalGate": "subject_of_gate"
    },
    {
      "roleId": "PL-074-PRO",
      "role": "Professional Caregiver",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Paid caregiver across multiple client households. Each client is a separate consented grant.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "planner:use",
        "dayplan:execute",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "copy:recipe",
        "print:recipe",
        "favorite:recipe",
        "view"
      ],
      "customGrants": [
        "client:multi_grant"
      ],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped per assigned/consented client",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-075-PRO",
      "role": "Geriatric Care Manager",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Manages multiple client households.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T6",
      "tierName": "Tenant Co-Admin",
      "capabilities": [
        "care_profile:edit",
        "hard_rule:propose",
        "planner:manage",
        "assign:caregivers",
        "report:read_operational",
        "note:write",
        "view"
      ],
      "customGrants": [
        "client:multi_manage"
      ],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped per client",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-076-PRO",
      "role": "Aging Life Care Manager",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Aging-life care coordination.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T6",
      "tierName": "Tenant Co-Admin",
      "capabilities": [
        "care_profile:edit",
        "hard_rule:propose",
        "planner:manage",
        "assign:caregivers",
        "report:read_operational",
        "note:write",
        "view"
      ],
      "customGrants": [
        "client:multi_manage"
      ],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped per client",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-077-PRO",
      "role": "Private Chef",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Cooks within client care rules.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "create:recipe",
        "planner:use",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped (dietary/care-relevant)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-078-PRO",
      "role": "Personal Chef",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Personal chef across clients.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "create:recipe",
        "planner:use",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-079-PRO",
      "role": "Meal Prep Professional",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Batch meal prep within rules.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "planner:use",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-080-PRO",
      "role": "Care Agency Admin",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Runs the agency roster & client book.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:invite:agency",
        "iam:grant_role",
        "assign",
        "client:multi_manage",
        "billing:manage:agency",
        "report:read_operational",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "agency:roster_manage"
      ],
      "denies": [],
      "dataScope": "org:agency",
      "phiAccess": "Scoped (agency clients)",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-081-PRO",
      "role": "Home Health Supervisor",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Supervises a care team.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T2",
      "tierName": "Manager / Approver",
      "capabilities": [
        "assign",
        "care_profile:view",
        "approve:work",
        "note:write",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:agency/team",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-082-PRO",
      "role": "Concierge Care Coordinator",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Concierge coordination.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T6",
      "tierName": "Tenant Co-Admin",
      "capabilities": [
        "care_profile:edit",
        "planner:manage",
        "assign",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-083-PRO",
      "role": "Professional Household Manager",
      "side": "Customer",
      "domain": "PRO",
      "domainsAtomic": [
        "PRO"
      ],
      "whatTheyDo": "Runs the household end to end.",
      "surface": "Future Pro Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T6",
      "tierName": "Tenant Co-Admin",
      "capabilities": [
        "care_profile:edit",
        "planner:manage",
        "shopping:manage",
        "recipe:generate",
        "copy:recipe",
        "print:recipe",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "client:assigned",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-084-CNUT",
      "role": "Registered Dietitian Nutritionist (External)",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "External licensed RDN. May approve the gate for their own patients only.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "care_profile:edit:nutrition",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "recipe:generate",
        "note:write",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "mnt:prescribe",
        "gate:approve:own_patients"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI (own consented patients)",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-085-CNUT",
      "role": "Clinical Nutritionist (External)",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "External clinical nutritionist.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "care_profile:edit:nutrition",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:own_patients"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-086-CNUT",
      "role": "Diet Technician",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "Supports the RDN; cannot set limits.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "care_profile:view",
        "food_log:write",
        "note:write",
        "copy:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-087-CNUT",
      "role": "Clinical Nutrition Manager",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "Manages the clinical nutrition team.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "assign",
        "iam:grant_role:team",
        "approve:work",
        "report:read_operational",
        "care_profile:view",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "team:manage"
      ],
      "denies": [],
      "dataScope": "org:clinic",
      "phiAccess": "Scoped PHI",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-088-CNUT",
      "role": "Physician",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "Treating physician.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "diagnosis:edit",
        "medication:edit",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "note:write",
        "view"
      ],
      "customGrants": [
        "order:clinical",
        "gate:approve:own_patients"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-089-CNUT",
      "role": "Nurse Practitioner",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "NP within scope of practice.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "diagnosis:edit",
        "medication:edit",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:own_patients"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-090-CNUT",
      "role": "Physician Assistant",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "PA under supervision.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "diagnosis:edit",
        "medication:edit",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:supervised"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-091-CNUT",
      "role": "Nurse Care Coordinator",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "Coordinates care tasks.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T4",
      "tierName": "Contributor",
      "capabilities": [
        "care_profile:view",
        "note:write",
        "assign:care_tasks",
        "food_log:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-092-CNUT",
      "role": "Pharmacist Reviewer (External)",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "External pharmacist drug–nutrient review.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "medication:interaction_review",
        "recipe:clinical_gate_approve:drug_nutrient_scoped",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:drug_nutrient_review"
      ],
      "denies": [],
      "dataScope": "patient:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-093-CNUT",
      "role": "Care Team Admin",
      "side": "Customer",
      "domain": "CLINICAL_CARE",
      "domainsAtomic": [
        "CLINICAL_CARE"
      ],
      "whatTheyDo": "Administers the care team surface.",
      "surface": "Clinical Nutrition Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:invite",
        "iam:grant_role",
        "assign",
        "audit:read_scoped",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "careteam:manage"
      ],
      "denies": [],
      "dataScope": "org:care-team",
      "phiAccess": "Scoped PHI",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-094-SL",
      "role": "Community Admin",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Administers the community/community group.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:invite",
        "iam:grant_role",
        "facility:configure",
        "billing:manage",
        "audit:read_scoped",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "facility:manage"
      ],
      "denies": [],
      "dataScope": "org:community",
      "phiAccess": "Scoped (community)",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-095-SL",
      "role": "Executive Director",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Community executive oversight.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "report:read_operational",
        "approve:work",
        "assign",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:community",
      "phiAccess": "Scoped (governance)",
      "dualControl": "No",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-096-SL",
      "role": "Dining Director",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Owns the dining program & menu cycles.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "menu:manage",
        "recipe:generate",
        "recipe:edit_flavor",
        "planner:manage:community",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "assign",
        "view"
      ],
      "customGrants": [
        "menu:cycle_manage"
      ],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "Scoped (resident diet/care)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-097-SL",
      "role": "Chef or Kitchen Manager",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Runs the kitchen to spec.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "planner:use",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "food_acceptance:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "Scoped (diet/texture/allergen)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-098-SL",
      "role": "Resident Care Director",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Owns resident care plans & hard rules.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "care_profile:edit",
        "hard_rule:edit",
        "medication:view",
        "assign",
        "note:write",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "care:oversee"
      ],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-099-SL",
      "role": "Wellness Director",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Owns wellness & hydration programs.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "care_profile:view",
        "hydration:program_manage",
        "report:read_operational",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "Scoped",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-100-SL",
      "role": "Staff Nurse",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Floor nursing for assigned residents.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "care_profile:view",
        "medication:view",
        "food_acceptance:write",
        "hydration:log",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "resident:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-101-SL",
      "role": "RDN or Nutrition Lead (Community)",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Community RDN; approves gate for the facility.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "care_profile:edit:nutrition",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:scoped",
        "menu:nutrition_review",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:facility"
      ],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-102-SL",
      "role": "Caregiver or CNA",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Daily resident care execution.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "food_acceptance:write",
        "hydration:log",
        "note:write",
        "dayplan:execute",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [
        "care_profile:edit"
      ],
      "dataScope": "resident:assigned",
      "phiAccess": "Scoped (care-relevant)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-103-SL",
      "role": "Family Viewer (Senior Living)",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Family window into one resident, consent-gated.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T8",
      "tierName": "Reader / Viewer",
      "capabilities": [
        "view",
        "favorite:recipe",
        "copy:recipe:allowed",
        "print:recipe:allowed",
        "note:family"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "resident:linked",
      "phiAccess": "Read-limited (one consented resident)",
      "dualControl": "No",
      "clinicalGate": "reads_gate_status"
    },
    {
      "roleId": "PL-104-SL",
      "role": "Resident",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "The resident — data subject.",
      "surface": "Senior Living — Profile Subject",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T9",
      "tierName": "Data Subject",
      "capabilities": [
        "self:view",
        "consent:manage",
        "food_acceptance:self",
        "note:self"
      ],
      "customGrants": [
        "consent:manage"
      ],
      "denies": [],
      "dataScope": "subject:self",
      "phiAccess": "Self only",
      "dualControl": "No",
      "clinicalGate": "subject_of_gate"
    },
    {
      "roleId": "PL-105-SL",
      "role": "Procurement or Inventory Manager",
      "side": "Customer",
      "domain": "SENIOR_LIVING",
      "domainsAtomic": [
        "SENIOR_LIVING"
      ],
      "whatTheyDo": "Supply & inventory only — no PHI.",
      "surface": "Senior Living Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "inventory:manage",
        "commerce:order",
        "product_catalog:view",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "facility:assigned",
      "phiAccess": "None (food/supply only, no resident PHI)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-106-VACC",
      "role": "Veteran",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Veteran; may own their own household.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T9",
      "tierName": "Data Subject",
      "capabilities": [
        "self:view",
        "consent:manage",
        "recipe:generate:self",
        "planner:use",
        "hydration:log",
        "food_log:self",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [
        "consent:manage",
        "self_owner"
      ],
      "denies": [],
      "dataScope": "subject:self",
      "phiAccess": "Self (own household)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-107-VACC",
      "role": "Family Caregiver (VA)",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Cares for a veteran.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "planner:use",
        "dayplan:execute",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "tenant:self",
      "phiAccess": "Scoped (veteran household, consented)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-108-VACC",
      "role": "VA Program Admin",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Administers the VA program.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:invite",
        "iam:grant_role",
        "program:configure",
        "report:read_aggregate",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "program:manage"
      ],
      "denies": [],
      "dataScope": "program:va",
      "phiAccess": "Aggregate / governed",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-109-VACC",
      "role": "VA Case Manager",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Manages a veteran caseload.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "care_profile:view",
        "assign",
        "note:write",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "caseload:assigned",
      "phiAccess": "Scoped PHI (caseload)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-110-VACC",
      "role": "Community Care Coordinator",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Coordinates community resources.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "care_profile:view",
        "assign",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "caseload:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-111-VACC",
      "role": "Nonprofit Program Admin",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Runs a nonprofit program.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:invite",
        "program:configure",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [
        "program:manage"
      ],
      "denies": [],
      "dataScope": "program:nonprofit",
      "phiAccess": "Aggregate",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-112-VACC",
      "role": "Food Bank Partner",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Supply partner; no PHI.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "inventory:view",
        "product_catalog:view",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "partner:contracted",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-113-VACC",
      "role": "Meal Delivery Partner",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Delivery only — least-necessary fields.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "order:fulfill",
        "delivery:manage",
        "view:delivery_fields"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "partner:contracted",
      "phiAccess": "Minimal (delivery address + diet/allergen flags only)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-114-VACC",
      "role": "Volunteer Coordinator",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Coordinates volunteers.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "assign:volunteers",
        "iam:invite:volunteer",
        "note:write",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "program:region",
      "phiAccess": "Minimal",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-115-VACC",
      "role": "Community Kitchen Lead",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Runs a community kitchen.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "recipe:generate",
        "recipe:edit_flavor",
        "planner:use",
        "shopping:manage",
        "copy:recipe",
        "print:recipe",
        "food_acceptance:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "kitchen:assigned",
      "phiAccess": "Scoped (diet/allergen)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-116-VACC",
      "role": "Benefits Navigator",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Helps people access benefits.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T8",
      "tierName": "Reader / Viewer",
      "capabilities": [
        "view",
        "note:write",
        "report:read_aggregate",
        "enroll:assist"
      ],
      "customGrants": [
        "enroll:assist"
      ],
      "denies": [],
      "dataScope": "caseload:assigned",
      "phiAccess": "Scoped (enrollment)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-117-VACC",
      "role": "Clinical Reviewer (Community)",
      "side": "Customer",
      "domain": "COMMUNITY_CARE",
      "domainsAtomic": [
        "COMMUNITY_CARE"
      ],
      "whatTheyDo": "Community clinical gate reviewer.",
      "surface": "VA & Community Care Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "recipe:clinical_gate_approve:scoped",
        "care_profile:view",
        "reject:gate",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:program"
      ],
      "denies": [],
      "dataScope": "program:region",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:scoped"
    },
    {
      "roleId": "PL-118-CT",
      "role": "Sponsor Admin",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Sponsor; blinded from PII per protocol.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "study:configure",
        "iam:grant_role",
        "report:read_aggregate",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "study:manage"
      ],
      "denies": [],
      "dataScope": "study:sponsored",
      "phiAccess": "Blinded / aggregate",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-119-CT",
      "role": "CRO Program Manager",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Runs trial operations.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "study:configure:ops",
        "assign",
        "report:read_operational",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "study:assigned",
      "phiAccess": "Blinded / scoped",
      "dualControl": "No",
      "clinicalGate": "oversees_gate"
    },
    {
      "roleId": "PL-120-CT",
      "role": "Principal Investigator",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "PI accountable for the site.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "protocol_rule:approve",
        "participant:enroll",
        "diagnosis:view",
        "medication:view",
        "recipe:clinical_gate_approve:study",
        "note:write",
        "view"
      ],
      "customGrants": [
        "protocol:signoff",
        "gate:approve:site"
      ],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI (site participants)",
      "dualControl": "Yes (protocol sign-off)",
      "clinicalGate": "approves_at:study"
    },
    {
      "roleId": "PL-121-CT",
      "role": "Sub-Investigator",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Delegated investigator tasks.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "participant:view",
        "recipe:clinical_gate_approve:delegated",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:delegated"
      ],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:study"
    },
    {
      "roleId": "PL-122-CT",
      "role": "Site Coordinator",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Runs day-to-day site operations.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "participant:enroll",
        "care_profile:edit:study",
        "food_log:write",
        "note:write",
        "assign",
        "view"
      ],
      "customGrants": [
        "crf:manage"
      ],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-123-CT",
      "role": "Study RDN",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Study dietitian; gate for the protocol.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "care_profile:edit:nutrition",
        "clinical_limit:set",
        "recipe:clinical_gate_approve:study",
        "note:write",
        "view"
      ],
      "customGrants": [
        "gate:approve:study"
      ],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:study"
    },
    {
      "roleId": "PL-124-CT",
      "role": "Clinical Research Nurse",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Research nursing tasks.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "participant:view",
        "medication:view",
        "food_log:write",
        "hydration:log",
        "note:write",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-125-CT",
      "role": "Participant",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Subject AND app user; logs own data.",
      "surface": "Clinical Trial — Profile Subject & App User",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T9",
      "tierName": "Data Subject",
      "capabilities": [
        "self:view",
        "consent:manage",
        "recipe:generate:self",
        "planner:use",
        "hydration:log",
        "food_log:self",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [
        "consent:manage"
      ],
      "denies": [],
      "dataScope": "subject:self",
      "phiAccess": "Self only",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-126-CT",
      "role": "Participant Caregiver",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Caregiver supporting a participant.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T7",
      "tierName": "Operator",
      "capabilities": [
        "recipe:generate",
        "planner:use",
        "dayplan:execute",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "copy:recipe",
        "print:recipe",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "participant:linked",
      "phiAccess": "Scoped (consented)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-127-CT",
      "role": "Data Manager (Study)",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Owns study data; works on coded data.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "data:catalog_manage:study",
        "data:export_deid",
        "report:build",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "edc:manage"
      ],
      "denies": [],
      "dataScope": "study:assigned",
      "phiAccess": "De-identified / coded",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-128-CT",
      "role": "CRA or Monitor",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Source data verification — read + flag only, no edit.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "audit:read_scoped",
        "sdv:verify",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "sdv:verify"
      ],
      "denies": [],
      "dataScope": "study:site",
      "phiAccess": "Scoped PHI (read for SDV)",
      "dualControl": "No",
      "clinicalGate": "monitors_gate"
    },
    {
      "roleId": "PL-129-CT",
      "role": "Safety Reviewer (Study)",
      "side": "Customer",
      "domain": "CLINICAL_TRIAL",
      "domainsAtomic": [
        "CLINICAL_TRIAL"
      ],
      "whatTheyDo": "Adjudicates adverse events; escalates to sponsor.",
      "surface": "Clinical Trial Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T3",
      "tierName": "Reviewer / Gatekeeper",
      "capabilities": [
        "safety:review",
        "safety:escalate",
        "ae:report",
        "approve:safety",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "ae:adjudicate",
        "escalate:sponsor"
      ],
      "denies": [],
      "dataScope": "study:assigned",
      "phiAccess": "Scoped PHI",
      "dualControl": "No",
      "clinicalGate": "approves_at:safety"
    },
    {
      "roleId": "PL-130-ENT",
      "role": "Enterprise Super Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Governs org config, NOT employee household contents. Households via benefit are fully walled.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O0",
      "tierName": "Org Root",
      "capabilities": [
        "org:configure",
        "iam:grant_role",
        "iam:invite",
        "sso:admin",
        "billing:manage",
        "audit:read_scoped",
        "report:read_operational",
        "view"
      ],
      "customGrants": [
        "org:root"
      ],
      "denies": [
        "household_phi"
      ],
      "dataScope": "org:enterprise",
      "phiAccess": "None by default (walled from employee household PHI)",
      "dualControl": "Yes (role grants, SSO)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-131-ENT",
      "role": "Organization Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Administers an organization.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O1",
      "tierName": "Org Admin",
      "capabilities": [
        "iam:grant_role",
        "iam:invite",
        "org:configure:sub",
        "report:read_operational",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:assigned",
      "phiAccess": "None by default",
      "dualControl": "Yes (role grants)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-132-ENT",
      "role": "Tenant Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Administers a tenant group.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "iam:invite:tenant",
        "tenant:configure",
        "report:read_operational",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:tenant-group",
      "phiAccess": "None by default",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-133-ENT",
      "role": "Department Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Department-level admin.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "iam:invite:dept",
        "seat:manage:dept",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:dept",
      "phiAccess": "None",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-134-ENT",
      "role": "Benefits Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Manages the benefit, not health data.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "seat:manage",
        "benefit:configure",
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "None (eligibility only, no health)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-135-ENT",
      "role": "Compliance Admin (Enterprise)",
      "side": "Customer",
      "domain": "ENTERPRISE / COMPLIANCE",
      "domainsAtomic": [
        "ENTERPRISE",
        "COMPLIANCE"
      ],
      "whatTheyDo": "Org compliance posture.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "compliance:configure:org",
        "retention:configure:org",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "Governed metadata",
      "dualControl": "Yes (retention)",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-136-ENT",
      "role": "Legal Reviewer (Enterprise)",
      "side": "Customer",
      "domain": "ENTERPRISE / LEGAL",
      "domainsAtomic": [
        "ENTERPRISE",
        "LEGAL"
      ],
      "whatTheyDo": "Org legal review.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "legal:review",
        "approve:legal",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "Scoped as needed",
      "dualControl": "No",
      "clinicalGate": "approves_at:legal"
    },
    {
      "roleId": "PL-137-ENT",
      "role": "Privacy Admin (Enterprise)",
      "side": "Customer",
      "domain": "ENTERPRISE / PRIVACY",
      "domainsAtomic": [
        "ENTERPRISE",
        "PRIVACY"
      ],
      "whatTheyDo": "Org privacy & DSRs.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "privacy:review",
        "privacy:dsr_process:org",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "dsr:process"
      ],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "Governed",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-138-ENT",
      "role": "Data Admin (Enterprise)",
      "side": "Customer",
      "domain": "ENTERPRISE / DATA",
      "domainsAtomic": [
        "ENTERPRISE",
        "DATA"
      ],
      "whatTheyDo": "Org data integrations & feeds.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O6",
      "tierName": "Org Governance",
      "capabilities": [
        "data:integration_manage",
        "data:export_deid",
        "data:catalog_manage:org",
        "view"
      ],
      "customGrants": [
        "integration:manage"
      ],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "De-identified",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-139-ENT",
      "role": "Reporting Executive",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Reads outcomes/ROI; never touches personal data.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "report:read_aggregate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "Aggregate-only (small-cell suppressed)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-140-ENT",
      "role": "Support Admin (Enterprise)",
      "side": "Customer",
      "domain": "ENTERPRISE / SUPPORT",
      "domainsAtomic": [
        "ENTERPRISE",
        "SUPPORT"
      ],
      "whatTheyDo": "Org-side support; routes to Pop & Ladle.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O3",
      "tierName": "Org Operator",
      "capabilities": [
        "support:ticket_manage",
        "support:account_state",
        "support:escalate",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "None (no health content)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-141-ENT",
      "role": "Finance and Billing Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Seats, invoices, budget.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O5",
      "tierName": "Aggregate / Ops Reader",
      "capabilities": [
        "billing:manage",
        "seat:manage",
        "report:read_operational:billing",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [],
      "denies": [],
      "dataScope": "org:enterprise",
      "phiAccess": "None (no user content)",
      "dualControl": "No",
      "clinicalGate": "n/a"
    },
    {
      "roleId": "PL-142-HH",
      "role": "Employee Caregiver",
      "side": "Customer",
      "domain": "HOUSEHOLD",
      "domainsAtomic": [
        "HOUSEHOLD"
      ],
      "whatTheyDo": "Full Owner of their own private household via benefit. Employer pays but cannot see any of it.",
      "surface": "Private Household App via Enterprise Benefit",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "T5",
      "tierName": "Tenant Owner",
      "capabilities": [
        "iam:invite",
        "iam:grant_role:household",
        "billing:view",
        "household:settings",
        "care_profile:create",
        "care_profile:edit",
        "hard_rule:edit",
        "medication:edit",
        "diagnosis:edit",
        "recipe:generate",
        "recipe:edit_flavor",
        "recipe:edit_content",
        "recipe:version_manage",
        "copy:recipe",
        "print:recipe",
        "favorite:recipe",
        "planner:manage",
        "dayplan:execute",
        "shopping:manage",
        "commerce:order",
        "hydration:log",
        "food_acceptance:write",
        "note:write",
        "issue:report",
        "delegation:manage",
        "export:tenant",
        "view"
      ],
      "customGrants": [
        "employer_pays_cannot_view",
        "full_owner_of_own_household"
      ],
      "denies": [],
      "dataScope": "tenant:self",
      "phiAccess": "Full (own household)",
      "dualControl": "No",
      "clinicalGate": "submits_to"
    },
    {
      "roleId": "PL-143-ENT",
      "role": "Partner Admin",
      "side": "Customer",
      "domain": "ENTERPRISE",
      "domainsAtomic": [
        "ENTERPRISE"
      ],
      "whatTheyDo": "Manages a contracted book of business.",
      "surface": "Enterprise Experience",
      "layer": "L3",
      "phase": "Phase 3",
      "tier": "O2",
      "tierName": "Sub-Org / Facility Admin",
      "capabilities": [
        "iam:invite:managed",
        "account:provision",
        "report:read_operational",
        "audit:read_scoped",
        "view"
      ],
      "customGrants": [
        "partner:slice_manage"
      ],
      "denies": [],
      "dataScope": "partner:contracted",
      "phiAccess": "None (no other org or personal data)",
      "dualControl": "Yes (provisioning)",
      "clinicalGate": "n/a"
    }
  ],
  "vocabulary": {
    "capabilities": [
      "access:time_boxed",
      "account:provision",
      "ae:adjudicate",
      "ae:report",
      "affiliate:manage",
      "agency:roster_manage",
      "ai:chairwoman_config:build",
      "approve:claims",
      "approve:clinical_copy",
      "approve:legal",
      "approve:medical_accuracy",
      "approve:privacy",
      "approve:regulatory",
      "approve:safety",
      "approve:visual",
      "approve:work",
      "asset:assemble",
      "asset:photo",
      "asset:upload",
      "assign",
      "assign:care_tasks",
      "assign:caregivers",
      "assign:volunteers",
      "audit:configure",
      "audit:export",
      "audit:read_global",
      "audit:read_global:read",
      "audit:read_scoped",
      "audit:read_scoped:household",
      "benefit:configure",
      "billing:manage",
      "billing:manage:agency",
      "billing:owner_of_record",
      "billing:view",
      "breakglass:approve",
      "breakglass:request",
      "care_profile:create",
      "care_profile:edit",
      "care_profile:edit:nutrition",
      "care_profile:edit:study",
      "care_profile:view",
      "care:oversee",
      "careteam:manage",
      "catalog:nutrition_manage",
      "claims:review",
      "claims:submit_for_review",
      "client:multi_grant",
      "client:multi_manage",
      "clinical_content:edit_verify",
      "clinical_content:write",
      "clinical_limit:set",
      "code:merge_approve",
      "code:pr",
      "code:write",
      "comment",
      "commerce:configure",
      "commerce:order",
      "compliance:boundary_manage",
      "compliance:configure",
      "compliance:configure:org",
      "compliance:review",
      "config:feature_flag",
      "config:global",
      "config:household_onboarding_defaults",
      "config:infra",
      "config:product",
      "config:product:propose",
      "config:schema_defaults",
      "consent:manage",
      "content:create_draft",
      "content:create_draft:sandbox",
      "content:edit",
      "content:layout",
      "content:layout:components",
      "content:layout:direction",
      "content:produce",
      "copy:recipe",
      "copy:recipe:allowed",
      "create",
      "create:family_recipe",
      "create:recipe",
      "crf:manage",
      "data:analyze",
      "data:analyze:research",
      "data:catalog_manage",
      "data:catalog_manage:nutrition",
      "data:catalog_manage:org",
      "data:catalog_manage:read",
      "data:catalog_manage:study",
      "data:export_deid",
      "data:integration_manage",
      "data:model_train",
      "data:pipeline_manage",
      "dayplan:execute",
      "delegation:manage",
      "delivery:manage",
      "deploy:approve",
      "deploy:approve:squad",
      "deploy:execute",
      "deploy:request",
      "diagnosis:edit",
      "diagnosis:view",
      "dsr:process",
      "edc:manage",
      "edit",
      "editorial:final_signoff",
      "employer_pays_cannot_view",
      "enroll:assist",
      "escalate:root",
      "escalate:sponsor",
      "export:tenant",
      "facility:configure",
      "facility:manage",
      "favorite:recipe",
      "feedback:loop_manage",
      "food_acceptance:self",
      "food_acceptance:write",
      "food_log:self",
      "food_log:write",
      "full_owner_of_own_household",
      "gate:approve",
      "gate:approve:delegated",
      "gate:approve:facility",
      "gate:approve:mnt",
      "gate:approve:nutrition",
      "gate:approve:own_patients",
      "gate:approve:program",
      "gate:approve:site",
      "gate:approve:study",
      "gate:approve:supervised",
      "gate:clinical_copy_signoff",
      "gate:drug_nutrient_review",
      "gate:legal_signoff",
      "gate:medical_signoff",
      "gate:rule_configure",
      "gate:safety_signoff",
      "grant:team:repo_env",
      "hard_rule:edit",
      "hard_rule:propose",
      "hardrule:explain_draft",
      "household:delete",
      "household:delete:any",
      "household:settings",
      "hydration:log",
      "hydration:program_manage",
      "iam:admin_personnel_manage",
      "iam:dual_control_root",
      "iam:grant_role",
      "iam:grant_role:household",
      "iam:grant_role:team",
      "iam:invite",
      "iam:invite:agency",
      "iam:invite:dept",
      "iam:invite:managed",
      "iam:invite:tenant",
      "iam:invite:volunteer",
      "iam:manage_scope",
      "iam:manage_scope:reviewers",
      "iam:manage_scope:support",
      "iam:review",
      "iam:revoke_role",
      "infra:provision",
      "integration:manage",
      "inventory:manage",
      "inventory:view",
      "issue:report",
      "keys:rotate",
      "legal:review",
      "library:accept",
      "library:lineage_manage",
      "library:quality_review",
      "library:tag",
      "medical_content:edit_verify",
      "medical_content:write",
      "medication:edit",
      "medication:interaction_review",
      "medication:view",
      "menu:cycle_manage",
      "menu:manage",
      "menu:nutrition_review",
      "mnt:prescribe",
      "model:eval_run",
      "model:feature_build",
      "model:key_manage",
      "model:route_configure",
      "model:route_configure:build",
      "model:run_monitor",
      "model:run_monitor:read",
      "monitor",
      "monitor:incident",
      "monitor:queue",
      "monitor:system_health",
      "nda:bound",
      "note:family",
      "note:self",
      "note:write",
      "order:clinical",
      "order:fulfill",
      "org:configure",
      "org:configure:sub",
      "org:root",
      "participant:enroll",
      "participant:view",
      "partner:slice_manage",
      "permission_engine:implement",
      "pii:tokenize_manage",
      "planner:manage",
      "planner:manage:community",
      "planner:use",
      "print:recipe",
      "print:recipe:allowed",
      "privacy:dsr_process",
      "privacy:dsr_process:org",
      "privacy:review",
      "product_catalog:manage",
      "product_catalog:view",
      "program:configure",
      "program:manage",
      "protocol_rule:approve",
      "protocol:signoff",
      "publish:editorial_signoff",
      "publish:hold",
      "publish:marketing:non_recipe",
      "publish:public",
      "publish:retract",
      "publish:schedule",
      "qa:plan",
      "qa:signoff",
      "qa:signoff:content",
      "qa:test",
      "qc:review",
      "queue:balance",
      "queue:configure",
      "recipe:clinical_gate_approve",
      "recipe:clinical_gate_approve:delegated",
      "recipe:clinical_gate_approve:drug_nutrient",
      "recipe:clinical_gate_approve:drug_nutrient_scoped",
      "recipe:clinical_gate_approve:scoped",
      "recipe:clinical_gate_approve:study",
      "recipe:clinical_gate_assign",
      "recipe:clinical_gate_configure",
      "recipe:clinical_gate_reject",
      "recipe:cookability_verify",
      "recipe:create_draft",
      "recipe:edit_content",
      "recipe:edit_flavor",
      "recipe:generate",
      "recipe:generate:self",
      "recipe:normalize_review",
      "recipe:version_manage",
      "reject:gate",
      "reject:work",
      "report:build",
      "report:read_aggregate",
      "report:read_operational",
      "report:read_operational:billing",
      "research:recruit",
      "retailer:route_configure",
      "retention:configure",
      "retention:configure:audit",
      "retention:configure:org",
      "reviewer:assign",
      "roadmap:decide",
      "safety:escalate",
      "safety:review",
      "sdv:verify",
      "search:index_manage",
      "search:index_manage:config",
      "seat:manage",
      "seat:manage:dept",
      "secrets:manage:scoped",
      "security:policy_author",
      "security:scan",
      "self_owner",
      "self:view",
      "self:view:if_enabled",
      "service:config:non_prod",
      "shopping:manage",
      "sso:admin",
      "study:configure",
      "study:configure:ops",
      "study:manage",
      "success:outreach",
      "support:account_state",
      "support:escalate",
      "support:ticket_manage",
      "support:ticket_manage:read",
      "taxonomy:edit",
      "taxonomy:edit:data",
      "taxonomy:edit:household",
      "taxonomy:smartfilter",
      "team:manage",
      "tenant:configure",
      "view",
      "view:assignment",
      "view:clinical_status",
      "view:delivery_fields",
      "view:review-context",
      "view:versions",
      "watermark:on"
    ],
    "denies": [
      "audit:mutate",
      "billing:*",
      "billing:manage",
      "care_profile:edit",
      "care_profile:edit(beyond acceptance)",
      "clinical_controls",
      "commerce_controls",
      "config:global",
      "household_phi",
      "household:delete",
      "household:settings",
      "iam:*",
      "owner_transfer",
      "publish:public",
      "recipe:delete"
    ],
    "sides": [
      "Company",
      "Customer"
    ],
    "domains": [
      "ADMIN",
      "ADMIN / CLINICAL",
      "ADMIN / COMPLIANCE",
      "ADMIN / DATA",
      "ADMIN / ENGINEERING",
      "ADMIN / FOOD",
      "ADMIN / PRODUCT",
      "ADMIN / SUPPORT",
      "CLINICAL",
      "CLINICAL / EDITORIAL",
      "CLINICAL_CARE",
      "CLINICAL_TRIAL",
      "COMMUNITY_CARE",
      "COMPLIANCE",
      "COMPLIANCE / PRIVACY",
      "COMPLIANCE / SAFETY",
      "DATA",
      "DATA / CLINICAL",
      "DATA / FOOD",
      "ENGINEERING",
      "ENGINEERING / AI",
      "ENGINEERING / DATA",
      "ENGINEERING / SECURITY",
      "ENTERPRISE",
      "ENTERPRISE / COMPLIANCE",
      "ENTERPRISE / DATA",
      "ENTERPRISE / LEGAL",
      "ENTERPRISE / PRIVACY",
      "ENTERPRISE / SUPPORT",
      "FOOD",
      "FOOD / EDITORIAL",
      "HOUSEHOLD",
      "LEGAL",
      "MEDICAL / EDITORIAL",
      "PRO",
      "PRODUCT",
      "PRODUCT / DESIGN",
      "PRODUCT / MARKETING",
      "PRODUCT / RESEARCH",
      "QA",
      "SENIOR_LIVING",
      "SUPPORT"
    ],
    "domainsAtomic": [
      "ADMIN",
      "AI",
      "CLINICAL",
      "CLINICAL_CARE",
      "CLINICAL_TRIAL",
      "COMMUNITY_CARE",
      "COMPLIANCE",
      "DATA",
      "DESIGN",
      "EDITORIAL",
      "ENGINEERING",
      "ENTERPRISE",
      "FOOD",
      "HOUSEHOLD",
      "LEGAL",
      "MARKETING",
      "MEDICAL",
      "PRIVACY",
      "PRO",
      "PRODUCT",
      "QA",
      "RESEARCH",
      "SAFETY",
      "SECURITY",
      "SENIOR_LIVING",
      "SUPPORT"
    ],
    "layers": [
      "L1",
      "L1/L2",
      "L2",
      "L2/L3",
      "L3"
    ],
    "phases": [
      "MVP",
      "Phase 3"
    ],
    "tiers": [
      {
        "code": "O0",
        "name": "Org Root"
      },
      {
        "code": "O1",
        "name": "Org Admin"
      },
      {
        "code": "O2",
        "name": "Sub-Org / Facility Admin"
      },
      {
        "code": "O3",
        "name": "Org Operator"
      },
      {
        "code": "O5",
        "name": "Aggregate / Ops Reader"
      },
      {
        "code": "O6",
        "name": "Org Governance"
      },
      {
        "code": "T0",
        "name": "Root Authority"
      },
      {
        "code": "T1",
        "name": "Platform Governor"
      },
      {
        "code": "T2",
        "name": "Manager / Approver"
      },
      {
        "code": "T3",
        "name": "Reviewer / Gatekeeper"
      },
      {
        "code": "T4",
        "name": "Contributor"
      },
      {
        "code": "T5",
        "name": "Tenant Owner"
      },
      {
        "code": "T6",
        "name": "Tenant Co-Admin"
      },
      {
        "code": "T7",
        "name": "Operator"
      },
      {
        "code": "T8",
        "name": "Reader / Viewer"
      },
      {
        "code": "T9",
        "name": "Data Subject"
      },
      {
        "code": "TC",
        "name": "Contractor (Sandboxed)"
      },
      {
        "code": "TEN",
        "name": "Tenant Boundary (object)"
      }
    ],
    "dataScopes": [
      "caseload:assigned",
      "catalog:nutrition",
      "catalog:taxonomy",
      "claims",
      "client:assigned",
      "clinical-deid",
      "compliance",
      "contractor-sandbox",
      "editorial",
      "editorial + clinical-deid",
      "editorial + medical",
      "editorial + recipe",
      "facility:assigned",
      "global",
      "infra",
      "internal + legal",
      "internal + security",
      "internal-deid",
      "internal-noPHI",
      "internal-noPHI + infra",
      "internal-noPHI + model-sandbox",
      "internal-noPHI + staging",
      "internal-noPHI + test-data",
      "kitchen:assigned",
      "medical",
      "org:agency",
      "org:agency/team",
      "org:assigned",
      "org:care-team",
      "org:clinic",
      "org:community",
      "org:dept",
      "org:enterprise",
      "org:tenant-group",
      "participant:linked",
      "partner:contracted",
      "patient:assigned",
      "privacy",
      "program:nonprofit",
      "program:region",
      "program:va",
      "resident:assigned",
      "resident:linked",
      "review-context",
      "safety",
      "study:assigned",
      "study:site",
      "study:sponsored",
      "subject:self",
      "support-context",
      "tenant:self",
      "tenant:self:read",
      "test-data",
      "test-data + content",
      "zone:admin-personnel",
      "zone:audit",
      "zone:clinical-review",
      "zone:commerce",
      "zone:compliance",
      "zone:master-library",
      "zone:model-ops",
      "zone:product-config",
      "zone:publishing",
      "zone:reporting",
      "zone:review-queues",
      "zone:support",
      "zone:system-health",
      "zone:taxonomy"
    ],
    "phiAccess": [
      "Aggregate",
      "Aggregate / de-identified",
      "Aggregate / governed",
      "Aggregate-only (small-cell suppressed)",
      "Blinded / aggregate",
      "Blinded / scoped",
      "Container for all tenant PHI",
      "De-identified",
      "De-identified (consented research data only)",
      "De-identified (consented research only)",
      "De-identified / aggregate",
      "De-identified / coded",
      "De-identified / tokenized (raw PHI tokenized at ingest)",
      "De-identified care profile + recipe",
      "De-identified review context",
      "Full (own household)",
      "Governed",
      "Governed (DSR handling)",
      "Governed (full, dual-control)",
      "Governed (policy, not row-level PHI)",
      "Governed metadata",
      "Metadata",
      "Metadata (audit records)",
      "Minimal",
      "Minimal (delivery address + diet/allergen flags only)",
      "None",
      "None (break-glass only)",
      "None (eligibility only, no health)",
      "None (food/supply only, no resident PHI)",
      "None (internal identity only)",
      "None (no health content)",
      "None (no other org or personal data)",
      "None (no PHI in route registry)",
      "None (no prod PHI)",
      "None (no user content)",
      "None (prod PHI = break-glass dual-control)",
      "None (recipe records)",
      "None (tests use de-identified care context)",
      "None by default",
      "None by default (walled from employee household PHI)",
      "Read (care-relevant view of one household)",
      "Read-limited (one consented resident)",
      "Scoped",
      "Scoped (agency clients)",
      "Scoped (care data needed to cook safely; no billing/admin)",
      "Scoped (care-relevant)",
      "Scoped (community)",
      "Scoped (consented)",
      "Scoped (diet/allergen)",
      "Scoped (diet/texture/allergen)",
      "Scoped (dietary/care-relevant)",
      "Scoped (enrollment)",
      "Scoped (governance)",
      "Scoped (least-necessary, consent/ticket-bound, time-boxed)",
      "Scoped (least-necessary, time-boxed, consent-bound)",
      "Scoped (matter-bound)",
      "Scoped (resident diet/care)",
      "Scoped (veteran household, consented)",
      "Scoped / aggregate (consented)",
      "Scoped as needed",
      "Scoped per assigned/consented client",
      "Scoped per client",
      "Scoped PHI",
      "Scoped PHI (caseload)",
      "Scoped PHI (own consented patients)",
      "Scoped PHI (read for SDV)",
      "Scoped PHI (site participants)",
      "Self (own household)",
      "Self only",
      "Synthetic",
      "Synthetic / de-identified only",
      "Synthetic only"
    ],
    "dualControl": [
      "n/a",
      "No",
      "Yes",
      "Yes (boundary/retention)",
      "Yes (break-glass, key rotation)",
      "Yes (high-risk recipes)",
      "Yes (household:delete = confirm + restore window)",
      "Yes (key management)",
      "Yes (prod deploy)",
      "Yes (protocol sign-off)",
      "Yes (provisioning)",
      "Yes (retention)",
      "Yes (role grants, SSO)",
      "Yes (role grants)",
      "Yes (scope grants)"
    ],
    "clinicalGate": [
      "approves_at:claims",
      "approves_at:clinical",
      "approves_at:clinical_copy",
      "approves_at:legal",
      "approves_at:medical",
      "approves_at:privacy",
      "approves_at:regulatory",
      "approves_at:safety",
      "approves_at:scoped",
      "approves_at:study",
      "cannot_approve_gate",
      "cannot_bypass_clinical_gate",
      "cannot_weaken_gate",
      "content_precedes_gate",
      "downstream_of_gate",
      "governs_gate",
      "monitors_gate",
      "n/a",
      "oversees_gate",
      "reads_gate_status",
      "scopes_gate",
      "subject_of_gate",
      "submits_to"
    ]
  }
}

export default ABAC_POLICY
