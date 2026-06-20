'use client';

import { useState, useMemo, useEffect } from 'react';
import Header from '@/components/ui/Header';
import {
  Save,
  Eye,
  EyeOff,
  Loader2,
  CreditCard,
} from 'lucide-react';
import { useAuth, UserRole } from '@/lib/auth';
import { authApi } from '@/lib/auth';
import { settingsApi } from '@/lib/api';
import { tabsConfig, paymentProviders, mockTeamMembers, notificationSettings, programPricing as defaultPricing } from './config';
import { styles } from './styles';
import type { SettingsTab } from './types';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('business');
  const [showApiKey, setShowApiKey] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Machine config state — loaded from BFF, falls back to config.ts defaults
  const [machineConfigLoaded, setMachineConfigLoaded] = useState(false);
  const [pricing, setPricing] = useState(defaultPricing);
  const [warningCycles, setWarningCycles] = useState(300);
  const [criticalCycles, setCriticalCycles] = useState(400);
  const [isSavingMachineConfig, setIsSavingMachineConfig] = useState(false);
  const [machineConfigError, setMachineConfigError] = useState('');
  const [machineConfigSuccess, setMachineConfigSuccess] = useState('');

  useEffect(() => {
    settingsApi.getMachineConfig()
      .then(config => {
        if (config.pricing.length > 0) setPricing(config.pricing);
        setWarningCycles(config.warningCycles);
        setCriticalCycles(config.criticalCycles);
        setMachineConfigLoaded(true);
      })
      .catch(() => setMachineConfigLoaded(true)); // use defaults on error
  }, []);

  const handleSaveMachineConfig = async () => {
    setIsSavingMachineConfig(true);
    setMachineConfigError('');
    setMachineConfigSuccess('');
    try {
      await settingsApi.saveMachineConfig({ pricing, warningCycles, criticalCycles });
      setMachineConfigSuccess('Machine configuration saved.');
      setTimeout(() => setMachineConfigSuccess(''), 3000);
    } catch {
      setMachineConfigError('Failed to save. Please try again.');
    } finally {
      setIsSavingMachineConfig(false);
    }
  };

  // Filter tabs based on user role
  const visibleTabs = useMemo(() => {
    if (!user) return [];
    return tabsConfig.filter((tab) => {
      // If no allowedRoles specified, all roles can see it
      if (!tab.allowedRoles || tab.allowedRoles.length === 0) {
        return true;
      }
      return tab.allowedRoles.includes(user.role);
    });
  }, [user]);

  // Check if user can edit current tab's content
  const canEditCurrentTab = useMemo(() => {
    if (!user) return false;
    const currentTabConfig = tabsConfig.find((t) => t.id === activeTab);
    if (!currentTabConfig) return false;
    // If no editableRoles specified, all roles that can see it can edit
    if (!currentTabConfig.editableRoles || currentTabConfig.editableRoles.length === 0) {
      return true;
    }
    return currentTabConfig.editableRoles.includes(user.role);
  }, [user, activeTab]);

  // Check if user can manage team members (add/edit users)
  const canManageUsers = useMemo(() => {
    if (!user) return false;
    // Admin, Owner, and Manager can manage users
    return [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER].includes(user.role);
  }, [user]);

  // Set first visible tab as active if current is not visible
  useMemo(() => {
    if (visibleTabs.length > 0 && !visibleTabs.find((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsChangingPassword(true);

    try {
      await authApi.changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully. You will be logged out...');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Logout after 2 seconds
      setTimeout(() => {
        logout();
      }, 2000);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setPasswordError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <>
      <Header title="Settings" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className={styles.container}>
          {/* Sidebar */}
          <div className={styles.sidebar}>
            <div className="card p-2">
              <nav className={styles.nav}>
                {visibleTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={styles.navButton(activeTab === tab.id)}
                    >
                      <Icon className={styles.navIcon} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Content */}
          <div className={styles.content}>
            {/* Business Settings */}
            {activeTab === 'business' && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Business Information</h3>
                {!canEditCurrentTab && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm">
                    You have read-only access to this section.
                  </div>
                )}
                <div className={styles.spaceY4}>
                  <div>
                    <label className={styles.label}>Business Name</label>
                    <input
                      type="text"
                      className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                      defaultValue="Smart Laundry Yaoundé"
                      readOnly={!canEditCurrentTab}
                    />
                  </div>
                  <div>
                    <label className={styles.label}>Address</label>
                    <input
                      type="text"
                      className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                      defaultValue="123 Avenue Kennedy, Yaoundé"
                      readOnly={!canEditCurrentTab}
                    />
                  </div>
                  <div className={styles.gridCols2}>
                    <div>
                      <label className={styles.label}>Phone</label>
                      <input
                        type="tel"
                        className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                        defaultValue="+237 6XX XXX XXX"
                        readOnly={!canEditCurrentTab}
                      />
                    </div>
                    <div>
                      <label className={styles.label}>Email</label>
                      <input
                        type="email"
                        className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                        defaultValue="contact@smartlaundry.cm"
                        readOnly={!canEditCurrentTab}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={styles.label}>Operating Hours</label>
                    <div className={styles.gridCols2}>
                      <input
                        type="time"
                        className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                        defaultValue="07:00"
                        readOnly={!canEditCurrentTab}
                      />
                      <input
                        type="time"
                        className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                        defaultValue="21:00"
                        readOnly={!canEditCurrentTab}
                      />
                    </div>
                  </div>
                  {canEditCurrentTab && (
                    <div className="pt-4">
                      <button className={styles.btnPrimary}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Changes
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Machine Settings - Only visible to Admin, Owner, Manager */}
            {activeTab === 'machines' && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Machine Configuration</h3>
                {!machineConfigLoaded ? (
                  <div className="flex items-center gap-2 text-gray-500 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading configuration…</span>
                  </div>
                ) : (
                <div className={styles.spaceY6}>
                  <div>
                    <h4 className={styles.sectionTitle}>Maintenance Thresholds</h4>
                    <div className={styles.gridCols2}>
                      <div>
                        <label className={styles.label}>Warning (cycles)</label>
                        <input
                          type="number"
                          className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                          value={warningCycles}
                          onChange={e => setWarningCycles(Number(e.target.value))}
                          readOnly={!canEditCurrentTab}
                        />
                      </div>
                      <div>
                        <label className={styles.label}>Critical (cycles)</label>
                        <input
                          type="number"
                          className={canEditCurrentTab ? styles.input : styles.inputReadOnly}
                          value={criticalCycles}
                          onChange={e => setCriticalCycles(Number(e.target.value))}
                          readOnly={!canEditCurrentTab}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className={styles.sectionTitle}>Program Pricing (XAF)</h4>
                    <div className={styles.spaceY3}>
                      {pricing.map((program, idx) => (
                        <div key={program.name} className="flex items-center justify-between">
                          <span className="text-gray-700">{program.name}</span>
                          <input
                            type="number"
                            className={`${canEditCurrentTab ? styles.input : styles.inputReadOnly} w-32`}
                            value={program.price}
                            onChange={e => {
                              const updated = [...pricing];
                              updated[idx] = { ...program, price: Number(e.target.value) };
                              setPricing(updated);
                            }}
                            readOnly={!canEditCurrentTab}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {machineConfigError && (
                    <p className="text-sm text-red-600">{machineConfigError}</p>
                  )}
                  {machineConfigSuccess && (
                    <p className="text-sm text-green-600">{machineConfigSuccess}</p>
                  )}

                  {canEditCurrentTab && (
                    <div className="pt-4">
                      <button
                        className={styles.btnPrimary}
                        onClick={handleSaveMachineConfig}
                        disabled={isSavingMachineConfig}
                      >
                        {isSavingMachineConfig
                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          : <Save className="w-4 h-4 mr-2" />
                        }
                        {isSavingMachineConfig ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </div>
                )}
              </div>
            )}

            {/* Notifications Settings - All roles can manage their own */}
            {activeTab === 'notifications' && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Notification Preferences</h3>
                <div className={styles.spaceY4}>
                  {notificationSettings.map((setting) => (
                    <div key={setting.label} className={styles.listItem}>
                      <div>
                        <p className="font-medium text-gray-900">{setting.label}</p>
                        <p className="text-sm text-gray-500">{setting.desc}</p>
                      </div>
                      <label className={styles.toggle.wrapper}>
                        <input
                          type="checkbox"
                          className={styles.toggle.input}
                          defaultChecked={setting.default}
                        />
                        <div className={styles.toggle.slider}></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Settings - Only visible to Admin, Owner */}
            {activeTab === 'payments' && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Payment Providers</h3>
                <div className={styles.spaceY4}>
                  {paymentProviders.map((provider) => (
                    <div
                      key={provider.name}
                      className={`flex items-center justify-between p-4 rounded-lg ${provider.color}`}
                    >
                      <div className="flex items-center">
                        <CreditCard className="w-5 h-5 mr-3" />
                        <span className="font-medium text-gray-900">{provider.name}</span>
                      </div>
                      <div className={styles.listItemActions}>
                        <button className={styles.btnLink}>Configure</button>
                        <label className={styles.toggle.wrapper}>
                          <input
                            type="checkbox"
                            className={styles.toggle.input}
                            defaultChecked={provider.enabled}
                          />
                          <div className={styles.toggle.slider}></div>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t">
                  <h4 className={styles.sectionTitle}>API Configuration</h4>
                  <div>
                    <label className={styles.label}>CamPay API Key</label>
                    <div className={styles.inputWrapper}>
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        className="input pr-10"
                        defaultValue="sk_live_xxxxxxxxxxxxxxxx"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Users Settings */}
            {activeTab === 'users' && (
              <div className={styles.card}>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="card-title">Team Members</h3>
                  {canManageUsers && (
                    <button className={styles.btnPrimary}>Add User</button>
                  )}
                </div>
                <div className={styles.spaceY3}>
                  {mockTeamMembers.map((member) => (
                    <div key={member.email} className={styles.listItem}>
                      <div className="flex items-center">
                        <div className={styles.avatar}>
                          <span className={styles.avatarText}>
                            {member.name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{member.name}</p>
                          <p className="text-sm text-gray-500">{member.email}</p>
                        </div>
                      </div>
                      <div className={styles.listItemActions}>
                        <span className={styles.badge}>{member.role}</span>
                        {canManageUsers && (
                          <button className={styles.btnLink}>Edit</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Security Settings - All roles can manage their own */}
            {activeTab === 'security' && (
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Security Settings</h3>
                <div className={styles.spaceY6}>
                  <form onSubmit={handlePasswordChange}>
                    <h4 className={styles.sectionTitle}>Change Password</h4>

                    {passwordError && (
                      <div className={styles.alertError}>{passwordError}</div>
                    )}

                    {passwordSuccess && (
                      <div className={styles.alertSuccess}>{passwordSuccess}</div>
                    )}

                    <div className={styles.spaceY3}>
                      <div>
                        <label className={styles.label}>Current Password</label>
                        <input
                          type="password"
                          className={styles.input}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          disabled={isChangingPassword}
                        />
                      </div>
                      <div>
                        <label className={styles.label}>New Password</label>
                        <input
                          type="password"
                          className={styles.input}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={isChangingPassword}
                          minLength={8}
                        />
                        <p className="mt-1 text-xs text-gray-500">Minimum 8 characters</p>
                      </div>
                      <div>
                        <label className={styles.label}>Confirm New Password</label>
                        <input
                          type="password"
                          className={styles.input}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={isChangingPassword}
                        />
                      </div>
                      <button
                        type="submit"
                        className={styles.btnPrimary}
                        disabled={isChangingPassword}
                      >
                        {isChangingPassword ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          'Update Password'
                        )}
                      </button>
                    </div>
                  </form>

                  <div className={styles.divider}>
                    <h4 className={styles.sectionTitle}>Two-Factor Authentication</h4>
                    <div className={styles.listItem}>
                      <div>
                        <p className="font-medium text-gray-900">Enable 2FA</p>
                        <p className="text-sm text-gray-500">
                          Add an extra layer of security to your account
                        </p>
                      </div>
                      <button className={styles.btnSecondary}>Setup</button>
                    </div>
                  </div>

                  <div className={styles.divider}>
                    <h4 className={styles.sectionTitle}>Active Sessions</h4>
                    <div className={styles.spaceY3}>
                      <div className={styles.listItem}>
                        <div>
                          <p className="font-medium text-gray-900">Current Session</p>
                          <p className="text-sm text-gray-500">Windows - Chrome</p>
                        </div>
                        <span className="badge badge-success">Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
