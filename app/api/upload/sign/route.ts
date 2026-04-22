import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { templateId, type } = body;

    const authKey = process.env.NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY;
    const authSecret = process.env.TRANSLOADIT_AUTH_SECRET;

    if (!authKey || !authSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Set expiry 1 hour from now (matching Transloadit SDK format)
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);
    const expiresString = expires.toISOString();

    const params: any = {
      auth: {
        key: authKey,
        expires: expiresString
      }
    };

    if (templateId) {
      params.template_id = templateId;
    } else {
      if (type === 'image') {
        params.steps = {
          image_exported: {
            use: ":original",
            robot: "/image/resize",
            resize_strategy: "fit",
            width: 1920,
            height: 1080,
            result: true
          }
        };
      } else {
        params.steps = {
          video_exported: {
            use: ":original",
            robot: "/file/filter",
            result: true
          }
        };
      }
    }

    const paramsString = JSON.stringify(params);

    // Calculate signature using HMAC-SHA384 (Transloadit v3 standard)
    // Transloadit expects the signature to be hex encoded and prefixed with the algorithm
    const digest = crypto
      .createHmac('sha384', authSecret)
      .update(Buffer.from(paramsString, 'utf-8'))
      .digest('hex');
      
    const signature = `sha384:${digest}`;

    return NextResponse.json({
      params: paramsString,
      signature
    });
  } catch (error: any) {
    console.error('Signature generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
