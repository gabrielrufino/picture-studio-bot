import type { CommandEnum } from '../enums/command.enum'
import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import type { PasswordBaseHandler } from './password-base.handler'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Recipe } from 'muhammara'
import { describe, expect, it, vi } from 'vitest'

export function createMockContext(text = 'password123'): CustomContext {
  return {
    t: (key: string) => key,
    from: { id: 123 },
    session: {
      command: null,
      params: { path: null },
    },
    message: {
      text,
      message_id: 1,
      document: {
        mime_type: 'application/pdf',
      },
    },
    chat: { id: 100 },
    getFile: vi.fn(),
    reply: vi.fn(),
    replyWithDocument: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as CustomContext
}

export function createMockUserRepository(): UserRepository {
  return {
    incrementUsage: vi.fn().mockResolvedValue({}),
    decrementUsage: vi.fn().mockResolvedValue({}),
  } as unknown as UserRepository
}

export async function createTestPdf(name: string): Promise<{ tempDir: string, filePath: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-studio-bot-test-${name}-`))
  const filePath = path.join(tempDir, 'input.pdf')
  await fs.copyFile(path.join(process.cwd(), 'assets/lorem-ipsum.pdf'), filePath)
  return { tempDir, filePath }
}

export async function createEncryptedTestPdf(name: string, password = 'password123'): Promise<{ tempDir: string, filePath: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-studio-bot-test-${name}-`))
  const filePath = path.join(tempDir, 'input.pdf')
  await new Promise((resolve, reject) => {
    new Recipe(path.join(process.cwd(), 'assets/lorem-ipsum.pdf'), filePath)
      .encrypt({ userPassword: password, ownerPassword: password })
      .endPDF((err?: Error) => {
        if (err) {
          return reject(err)
        }
        resolve(null)
      })
  })
  return { tempDir, filePath }
}

export function testPasswordBaseHandlerBehavior(
  getHandler: () => PasswordBaseHandler,
  getCtx: () => CustomContext,
  command: CommandEnum,
  prefix: string,
) {
  it('should have correct command', () => {
    expect(getHandler().command).toBe(command)
  })

  describe('onCommand', () => {
    it('should set session command and ask for file', async () => {
      const handler = getHandler()
      const ctx = getCtx()
      await handler.onCommand(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(`${prefix}_send_file`)
      expect(ctx.session.command).toBe(command)
      expect(ctx.session.params).toEqual({ path: null })
    })
  })

  describe('common events', () => {
    it('should download file on msg:document', async () => {
      const handler = getHandler()
      const ctx = getCtx()
      const filePath = '/tmp/test.pdf'
      vi.mocked(ctx.getFile).mockResolvedValueOnce({
        download: vi.fn().mockResolvedValue(filePath),
      } as any)
      await handler.events['msg:document'](ctx)
      expect(ctx.session.params).toEqual({ path: filePath })
      expect(ctx.reply).toHaveBeenCalledWith(`${prefix}_send_password`)
    })

    it('should handle errors and keep session for retry', async () => {
      const handler = getHandler()
      const ctx = getCtx()
      const inputPath = '/invalid'
      ctx.session.params = { path: inputPath }
      ctx.session.command = command

      await handler.events['msg:text'](ctx)

      expect(ctx.reply).toHaveBeenCalledWith(`${prefix}_error`)
      expect(ctx.session.command).toBe(command)
      expect(ctx.session.params.path).toBe(inputPath)
    })
  })
}
