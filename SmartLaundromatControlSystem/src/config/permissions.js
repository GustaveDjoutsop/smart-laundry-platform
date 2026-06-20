/**
 * Role and Permission Configuration
 * Centralized configuration for role-based access control (RBAC)
 */

// Role hierarchy with numeric levels (higher = more privileges)
const ROLES = {
  ADMIN: { name: 'admin', level: 100 },
  OWNER: { name: 'owner', level: 80 },
  MANAGER: { name: 'manager', level: 60 },
  ACCOUNTANT: { name: 'accountant', level: 40 },
  EMPLOYEE: { name: 'employee', level: 20 }
};

// Role levels for quick lookup
const ROLE_LEVELS = {
  admin: 100,
  owner: 80,
  manager: 60,
  accountant: 40,
  employee: 20
};

// Permission matrix: which roles have which permissions
const PERMISSIONS = {
  // Users permissions
  'users:create': ['admin', 'owner'],
  'users:read': ['admin', 'owner', 'manager'],
  'users:update': ['admin', 'owner'],
  'users:delete': ['admin'],
  'users:assign-role': ['admin', 'owner'],

  // Machines permissions
  'machines:read': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'machines:control': ['admin', 'owner', 'manager', 'employee'],
  'machines:config': ['admin', 'owner'],
  'machines:maintenance': ['admin', 'owner', 'manager'],

  // Transactions permissions
  'transactions:read': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'transactions:export': ['admin', 'owner', 'manager', 'accountant'],
  'transactions:refund': ['admin', 'owner', 'manager'],

  // Finance permissions
  'finance:dashboard': ['admin', 'owner', 'manager', 'accountant'],
  'finance:reports': ['admin', 'owner', 'manager', 'accountant'],
  'finance:export': ['admin', 'owner', 'manager', 'accountant'],
  'finance:settings': ['admin', 'owner'],

  // System permissions
  'system:settings': ['admin', 'owner'],
  'system:logs': ['admin', 'owner', 'manager'],
  'system:backup': ['admin'],

  // Timekeeping permissions
  'timekeeping:clock': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'timekeeping:view_own': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'timekeeping:view_all': ['admin', 'owner', 'manager'],
  'timekeeping:manage': ['admin', 'owner', 'manager'], // Manual entries, corrections

  // Absence permissions
  'absences:create_own': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'absences:view_all': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'absences:approve': ['admin', 'owner', 'manager'],

  // Legacy permissions (for backward compatibility)
  'dashboard:view': ['admin', 'owner', 'manager', 'accountant', 'employee'],
  'revenue:view': ['admin', 'owner', 'manager', 'accountant'],
  'reports:view': ['admin', 'owner', 'manager', 'accountant'],
  'reports:export': ['admin', 'owner', 'manager', 'accountant'],
  'expenses:view': ['admin', 'owner', 'manager', 'accountant'],
  'expenses:create': ['admin', 'owner', 'manager'],
  'expenses:edit': ['admin', 'owner'],
  'settings:view': ['admin', 'owner'],
  'settings:edit': ['admin', 'owner'],
  'reconciliation:run': ['admin', 'owner', 'manager'],
  'cafe:view': ['admin', 'owner', 'manager'],
  'cafe:manage': ['admin', 'owner', 'manager']
};

// Which roles can create which other roles
const ROLE_CREATION_PERMISSIONS = {
  admin: ['admin', 'owner', 'manager', 'accountant', 'employee'],
  owner: ['manager', 'accountant', 'employee'],
  manager: [],
  accountant: [],
  employee: []
};

/**
 * Check if a role has a specific permission
 * @param {string} role - The user's role
 * @param {string} permission - The permission to check
 * @returns {boolean}
 */
const hasPermission = (role, permission) => {
  if (!role || !permission) return false;

  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;

  return allowedRoles.includes(role.toLowerCase());
};

/**
 * Check if a role can assign another role
 * @param {string} assignerRole - The role of the user assigning
 * @param {string} targetRole - The role being assigned
 * @returns {boolean}
 */
const canAssignRole = (assignerRole, targetRole) => {
  if (!assignerRole || !targetRole) return false;

  const allowedRoles = ROLE_CREATION_PERMISSIONS[assignerRole.toLowerCase()];
  if (!allowedRoles) return false;

  return allowedRoles.includes(targetRole.toLowerCase());
};

/**
 * Get the level of a role
 * @param {string} role - The role name
 * @returns {number}
 */
const getRoleLevel = (role) => {
  if (!role) return 0;
  return ROLE_LEVELS[role.toLowerCase()] || 0;
};

/**
 * Check if one role has a higher level than another
 * @param {string} role1 - First role
 * @param {string} role2 - Second role
 * @returns {boolean} - True if role1 has higher level than role2
 */
const isHigherRole = (role1, role2) => {
  return getRoleLevel(role1) > getRoleLevel(role2);
};

/**
 * Check if one role has equal or higher level than another
 * @param {string} role1 - First role
 * @param {string} role2 - Second role
 * @returns {boolean}
 */
const isRoleAtLeast = (role1, role2) => {
  return getRoleLevel(role1) >= getRoleLevel(role2);
};

/**
 * Get all permissions for a role
 * @param {string} role - The role name
 * @returns {string[]} - Array of permission strings
 */
const getRolePermissions = (role) => {
  if (!role) return [];

  const rolePermissions = [];
  const roleLower = role.toLowerCase();

  for (const [permission, allowedRoles] of Object.entries(PERMISSIONS)) {
    if (allowedRoles.includes(roleLower)) {
      rolePermissions.push(permission);
    }
  }

  return rolePermissions;
};

/**
 * Get all valid role names
 * @returns {string[]}
 */
const getValidRoles = () => {
  return Object.values(ROLES).map(r => r.name);
};

module.exports = {
  ROLES,
  ROLE_LEVELS,
  PERMISSIONS,
  ROLE_CREATION_PERMISSIONS,
  hasPermission,
  canAssignRole,
  getRoleLevel,
  isHigherRole,
  isRoleAtLeast,
  getRolePermissions,
  getValidRoles
};
