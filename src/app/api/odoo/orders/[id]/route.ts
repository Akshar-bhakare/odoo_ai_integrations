import { NextRequest, NextResponse } from 'next/server';
import { getSalesOrderById } from '@/lib/odoo/services';
import { OdooConfigurationError, OdooApiError } from '@/lib/odoo/client';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;
  const { id } = await context.params;
  const orderId = parseInt(id, 10);

  if (isNaN(orderId)) {
    return NextResponse.json(
      { error: 'INVALID_ID', message: 'Order ID must be a valid integer.' },
      { status: 400 }
    );
  }

  try {
    const details = await getSalesOrderById(orderId);
    return NextResponse.json(details);
  } catch (error: unknown) {
    console.error(`Error fetching order detail for ID ${orderId}:`, error);

    if (error instanceof OdooConfigurationError) {
      return NextResponse.json(
        { 
          error: 'CONFIGURATION_ERROR', 
          message: error.message 
        },
        { status: 500 }
      );
    }
    
    if (error instanceof OdooApiError) {
      return NextResponse.json(
        { 
          error: 'API_ERROR', 
          message: error.message,
          code: error.code,
          data: error.data
        },
        { status: error.code === 429 ? 429 : 500 }
      );
    }

    const message = error instanceof Error ? error.message : '';
    if (message.includes('not found')) {
      return NextResponse.json(
        { 
          error: 'NOT_FOUND', 
          message: message 
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { 
        error: 'INTERNAL_SERVER_ERROR', 
        message: message || 'An unexpected error occurred while communicating with Odoo.'
      },
      { status: 500 }
    );
  }
}
