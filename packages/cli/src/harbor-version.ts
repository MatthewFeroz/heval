import toolchain from '../../../harbor/toolchain.json'

export const HARBOR_VERSION = toolchain.runner.version

export function supportedHarborVersion(output: string | null): boolean {
  return output !== null && output.trim().split(/\s+/).at(-1) === HARBOR_VERSION
}
