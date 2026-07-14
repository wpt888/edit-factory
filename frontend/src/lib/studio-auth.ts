type AuthResult = { error: unknown };

export type StudioAuthClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<AuthResult>;
    verifyOtp(params: {
      token_hash: string;
      type: "magiclink";
    }): Promise<AuthResult>;
  };
};

export type StudioAuthParams = {
  code: string | null;
  tokenHash: string | null;
  verificationType: string | null;
};

export type StudioAuthCompletion = {
  handled: boolean;
  error: unknown;
};

/** Complete either the existing Supabase PKCE callback or the single-use
 * BlipCreative → BlipStudio launch token. PKCE deliberately takes precedence
 * if a malformed request contains both mechanisms. */
export async function completeStudioAuth(
  client: StudioAuthClient,
  params: StudioAuthParams,
): Promise<StudioAuthCompletion> {
  if (params.code) {
    const { error } = await client.auth.exchangeCodeForSession(params.code);
    return { handled: true, error };
  }

  if (params.tokenHash && params.verificationType === "magiclink") {
    const { error } = await client.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: "magiclink",
    });
    return { handled: true, error };
  }

  return { handled: false, error: null };
}
