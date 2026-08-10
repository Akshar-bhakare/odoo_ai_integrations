import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadAuthenticatedActor } from '@/lib/auth/odoo-identity';
import { sessionFromRequest } from '@/lib/auth/session';
import { OdooApiError } from '@/lib/odoo/client';

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  try {
    const actor = await loadAuthenticatedActor(session.userId);
    return NextResponse.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      actor: {
        name: actor.name,
        login: actor.login,
        currentCompanyId: actor.currentCompanyId,
        employeeId: actor.employeeId,
        employeeMapping: actor.employeeMapping,
        roles: actor.roles,
      },
    });
  } catch (error) {
    if (error instanceof OdooApiError && error.code === 429) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
