import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export const config = {
  matcher: ['/api/sub', '/api/sub/'],
};
