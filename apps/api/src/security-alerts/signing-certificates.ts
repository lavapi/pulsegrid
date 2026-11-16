import { X509Certificate } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isSigningCertUrl } from './sns-signature';

const TIMEOUT_MS = 3_000;
const MAX_CACHED = 20;

export type FetchText = (url: string) => Promise<string>;

export const FETCH_CERTIFICATE = Symbol('FETCH_CERTIFICATE');

export const fetchCertificate: FetchText = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Certificate download answered ${response.status}`);
  }
  return response.text();
};

/** SNS signing certificates, downloaded only from SNS hosts and kept while they are valid. */
@Injectable()
export class SigningCertificates {
  private readonly cache = new Map<string, { pem: string; validTo: number }>();

  constructor(@Inject(FETCH_CERTIFICATE) private readonly download: FetchText) {}

  async get(url: string): Promise<string> {
    if (!isSigningCertUrl(url)) {
      throw new Error('The signing certificate is not on an SNS host');
    }
    const cached = this.cache.get(url);
    if (cached && cached.validTo > Date.now()) {
      return cached.pem;
    }
    const pem = await this.download(url);
    const validTo = new Date(new X509Certificate(pem).validTo).getTime();
    if (this.cache.size >= MAX_CACHED) {
      this.cache.clear();
    }
    this.cache.set(url, { pem, validTo });
    return pem;
  }
}
