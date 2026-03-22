import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return bcrypt.hashSync(token, 4); // lighter hash for refresh tokens
}

export function compareToken(token: string, hash: string): boolean {
  return bcrypt.compareSync(token, hash);
}
