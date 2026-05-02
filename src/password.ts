import bcrypt from "bcryptjs";

/**
 * 密码来源类型。
 * - "plain": 明文密码，需要客户端进行哈希处理
 * - "hashed": 已哈希的密码，直接传递给服务器
 */
export type PasswordSource = "plain" | "hashed";

/**
 * 密码输入对象。
 * 用于在认证和用户管理操作中传递密码信息。
 * 支持明文密码（客户端自动哈希）和已哈希的密码两种来源。
 */
export interface PasswordInput {
  readonly source: PasswordSource;
  readonly encoded: string;
}

/**
 * 对明文密码进行 bcrypt 哈希处理。
 * 使用 10 轮 salt 进行哈希，返回哈希后的密码字符串。
 *
 * @param plain - 明文密码，不能为空字符串
 * @returns 返回 bcrypt 哈希后的密码字符串
 * @throws 如果密码为空则抛出错误
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain === "") {
    throw new Error("password is required");
  }
  return bcrypt.hash(plain, 10);
}

/**
 * 将明文密码转换为 PasswordInput 对象（异步方式）。
 * 自动对明文进行 bcrypt 哈希处理，来源标记为 "plain"。
 *
 * @param plain - 明文密码，不能为空字符串
 * @returns 返回包含哈希后密码的 PasswordInput 对象
 * @throws 如果密码为空则抛出错误
 */
export async function plainPassword(plain: string): Promise<PasswordInput> {
  return { source: "plain", encoded: await hashPassword(plain) };
}

/**
 * 将明文密码转换为 PasswordInput 对象（同步方式）。
 * 使用 bcrypt.hashSync 进行同步哈希处理。
 *
 * @param plain - 明文密码，不能为空字符串
 * @returns 返回包含哈希后密码的 PasswordInput 对象
 * @throws 如果密码为空则抛出错误
 */
export function plainPasswordSync(plain: string): PasswordInput {
  if (plain === "") {
    throw new Error("password is required");
  }
  return { source: "plain", encoded: bcrypt.hashSync(plain, 10) };
}

/**
 * 从已有的 bcrypt 哈希值创建 PasswordInput 对象。
 * 用于当密码已经经过哈希处理，需要直接传递给服务器的场景。
 *
 * @param hash - 已有的 bcrypt 哈希字符串
 * @returns 返回来源标记为 "hashed" 的 PasswordInput 对象
 */
export function hashedPassword(hash: string): PasswordInput {
  return { source: "hashed", encoded: hash };
}

/**
 * 验证 PasswordInput 对象是否合法。
 * 检查来源类型是否为 "plain" 或 "hashed"，以及编码值是否为空。
 *
 * @param password - 待验证的密码输入对象
 * @throws 如果来源类型无效或密码为空则抛出错误
 */
export function validatePassword(password: PasswordInput): void {
  if (password.source !== "plain" && password.source !== "hashed") {
    throw new Error(`invalid password source ${JSON.stringify(password.source)}`);
  }
  if (password.encoded === "") {
    throw new Error("password is required");
  }
}

/**
 * 获取密码的线格式值（wire value），用于在 API 调用中传输。
 * 在取值前会自动验证密码对象的合法性。
 *
 * @param password - 密码输入对象
 * @returns 返回密码的编码值（哈希后的字符串）
 * @throws 如果密码对象不合法则抛出错误
 */
export function passwordWireValue(password: PasswordInput): string {
  validatePassword(password);
  return password.encoded;
}
