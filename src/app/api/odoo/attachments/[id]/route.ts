import { NextRequest, NextResponse } from 'next/server';
import { getAttachmentData } from '@/lib/odoo/services';
import { OdooConfigurationError, OdooApiError } from '@/lib/odoo/client';
import { legacyOdooRouteGuard } from '@/lib/auth/api-auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;
  const { id } = await context.params;
  const attachmentId = parseInt(id, 10);

  if (isNaN(attachmentId)) {
    return NextResponse.json(
      { error: 'INVALID_ID', message: 'Attachment ID must be a valid integer.' },
      { status: 400 }
    );
  }

  try {
    const attachment = await getAttachmentData(attachmentId);

    if (!attachment.datas) {
      return NextResponse.json(
        { error: 'NO_CONTENT', message: 'This attachment has no data content.' },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(attachment.datas, 'base64');

    const { searchParams } = new URL(request.url);
    const isDownload = searchParams.get('download') === 'true';
    const dispositionMode = isDownload ? 'attachment' : 'inline';
    const filename = attachment.name || 'document';

    return new Response(buffer, {
      headers: {
        'Content-Type': attachment.mimetype || 'application/octet-stream',
        'Content-Disposition': `${dispositionMode}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    console.error(`Error proxying attachment for ID ${attachmentId}:`, error);

    if (error instanceof OdooConfigurationError) {
      return NextResponse.json(
        { error: 'CONFIGURATION_ERROR', message: error.message },
        { status: 500 }
      );
    }

    if (error instanceof OdooApiError) {
      return NextResponse.json(
        { error: 'API_ERROR', message: error.message, code: error.code },
        { status: error.code === 429 ? 429 : 500 }
      );
    }

    const message = error instanceof Error ? error.message : '';
    if (message.includes('not found')) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: `Attachment with ID ${attachmentId} was not found in Odoo.` },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: message || 'Failed to fetch attachment from Odoo.' },
      { status: 500 }
    );
  }
}
