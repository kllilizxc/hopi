import { join } from 'path'
import { tmpdir } from 'os'
import { PRODUCT_SLUG } from '@hopi/protocol/brand'

export const HOPI_BLOBS_DIR_NAME = `${PRODUCT_SLUG}-blobs`

export function getHopiBlobsDir(): string {
    return join(tmpdir(), HOPI_BLOBS_DIR_NAME)
}
