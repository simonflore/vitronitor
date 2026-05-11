/**
 * Org context — single-org-per-user assumption.
 *
 * Loads the current user's first org_members row and exposes { orgId, orgName }.
 *
 * To support multi-org switching:
 *   1. Load all org_members rows for the user
 *   2. Persist the user's selected org id (localStorage)
 *   3. Add a switcher UI
 *   4. Send X-Org-Id on every API call (see lib/api-client.ts)
 *   5. Recreate sync collections on org switch (see TanStackDbProvider)
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from './AuthContext';

interface OrgContextValue {
  orgId: string | null;
  orgName: string | null;
  isLoading: boolean;
  error: string | null;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// Module-level mirror of the resolved orgId, set by the provider every time
// it changes. Read by code that runs outside React (sync collection factory)
// where calling a hook isn't possible.
let _currentOrgId: string | null = null;
export function getCurrentOrgId(): string | null {
  return _currentOrgId;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const [state, setState] = useState<Omit<OrgContextValue, never>>({
    orgId: null,
    orgName: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (status === 'loading') return;
    if (!user) {
      _currentOrgId = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external auth state (signed-out) into local org state
      setState({ orgId: null, orgName: null, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('org_members')
        .select('org_id, orgs(name)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState({ orgId: null, orgName: null, isLoading: false, error: error.message });
        return;
      }
      if (!data) {
        setState({
          orgId: null,
          orgName: null,
          isLoading: false,
          error: 'No org found for user (the on_auth_user_created trigger may not be installed)',
        });
        return;
      }

      // Supabase typing: orgs is an embedded relation. With single-row .single(),
      // it comes back as object | null; with foreign-table select() it can also
      // be an array. Normalize either shape.
      const orgsRel = (data as { orgs: { name: string } | { name: string }[] | null }).orgs;
      const orgName = Array.isArray(orgsRel) ? (orgsRel[0]?.name ?? null) : (orgsRel?.name ?? null);

      const resolvedOrgId = (data as { org_id: string }).org_id;
      _currentOrgId = resolvedOrgId;
      setState({
        orgId: resolvedOrgId,
        orgName,
        isLoading: false,
        error: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, status]);

  const value = useMemo<OrgContextValue>(() => state, [state]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
