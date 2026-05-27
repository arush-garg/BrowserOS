import { spawn } from 'node:child_process'
import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'
import type {
  ContainerCli,
  ContainerCommandResult,
  LogFn,
} from '../../../lib/container'
import type { VmRuntime } from '../../../lib/vm'
import { ContainerRuntime } from './container-runtime'

export class NativeOpenClawRuntime extends ContainerRuntime {
  constructor(
    projectDir: string,
    private readonly nativeConfig: {
      port: number
      token?: string
      configDir: string
    },
  ) {
    super({
      vm: {} as VmRuntime,
      shell: {} as ContainerCli,
      loader: {
        ensureImageLoaded: async () => {},
        ensureAgentImageLoaded: async () => '',
      },
      projectDir,
    })
  }

  override getNativeConfig() {
    return {
      port: this.nativeConfig.port,
      token: this.nativeConfig.token,
      configDir: this.nativeConfig.configDir,
    }
  }

  override async ensureReady(): Promise<void> {}

  override async isPodmanAvailable(): Promise<boolean> {
    return true
  }

  override async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    return { initialized: true, running: true }
  }

  override async pullImage(): Promise<void> {}

  override async prewarmGatewayImage(): Promise<void> {}

  override async isGatewayCurrent(): Promise<boolean> {
    return true
  }

  override async startGateway(): Promise<void> {}

  override async stopGateway(): Promise<void> {}

  override async restartGateway(): Promise<void> {}

  override async getGatewayLogs(): Promise<string[]> {
    return ['(Native OpenClaw logs not available through BrowserOS)']
  }

  override async stopVm(): Promise<void> {}

  override async isHealthy(hostPort: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${hostPort}/v1/models`, {
        headers: this.nativeConfig.token
          ? { Authorization: `Bearer ${this.nativeConfig.token}` }
          : undefined,
      })
      return res.ok
    } catch {
      return false
    }
  }

  override async isReady(hostPort: number): Promise<boolean> {
    return this.isHealthy(hostPort)
  }

  private rewriteCommand(command: string[]): string[] {
    // Rewrite 'node dist/index.js' or 'exec openclaw-gateway ...' -> 'openclaw'
    let newCmd = [...command]

    // Sometimes runInContainer prepends 'exec' and container name. We should strip those.
    // 'exec', OPENCLAW_GATEWAY_CONTAINER_NAME, 'node', 'dist/index.js', ...
    if (newCmd[0] === 'exec') {
      newCmd = newCmd.slice(2)
    }

    if (newCmd[0] === 'node' && newCmd[1] === 'dist/index.js') {
      newCmd = ['openclaw', ...newCmd.slice(2)]
    }

    // Replace OPENCLAW_CONTAINER_HOME with actual configDir
    newCmd = newCmd.map((arg) =>
      arg.replace(OPENCLAW_CONTAINER_HOME, this.nativeConfig.configDir),
    )
    return newCmd
  }

  override async execInContainer(
    command: string[],
    onLog?: LogFn,
  ): Promise<number> {
    const rewritten = this.rewriteCommand(command)
    return new Promise((resolve) => {
      const proc = spawn(rewritten[0], rewritten.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line) onLog?.(line)
        }
      })

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line) onLog?.(line)
        }
      })

      proc.on('close', (code) => {
        resolve(code ?? 0)
      })

      proc.on('error', (err) => {
        onLog?.(`Error executing ${rewritten[0]}: ${err.message}`)
        resolve(1)
      })
    })
  }

  override async runInContainer(
    command: string[],
  ): Promise<ContainerCommandResult> {
    const rewritten = this.rewriteCommand(command)
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(rewritten[0], rewritten.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 0, stdout, stderr })
      })

      proc.on('error', (err) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message })
      })
    })
  }
}
