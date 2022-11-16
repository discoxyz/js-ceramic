import { StreamID } from '@ceramicnetwork/streamid'
import {
  DiagnosticsLogger,
  Networks,
  Stream,
  StreamState,
  StreamStateHolder,
  StreamUtils
} from '@ceramicnetwork/common'
import { ObjectStore } from './object-store.js'
import { StoreWrapperInterface } from './store-wrapper-interface.js'

function generateKey(object: StreamID): string {
  return object.toString()
}

function serialize(value: StreamState): any {
  return StreamUtils.serializeState(value)
}

function  deserialize(serialized: string): StreamState {
  return StreamUtils.deserializeState(serialized)
}

export class StateStore extends ObjectStore<StreamID, StreamState> {
  #logger: DiagnosticsLogger

  constructor(logger: DiagnosticsLogger) {
    super(generateKey, serialize, deserialize)
    this.#logger = logger
  }

  /**
   * Gets network name
   */
  get networkName(): string {
    return this.store.networkName
  }

  /**
   * Pin stream
   * @param stream - Stream instance
   */
  async saveFromStream(stream: Stream): Promise<void> {
    await this.save(stream.id, stream.state)
  }

  /**
   * Pin stream
   * @param streamStateHolder - Stream instance
   */
  async saveFromStreamStateHolder(streamStateHolder: StreamStateHolder): Promise<void> {
    await this.save(streamStateHolder.id, streamStateHolder.state)
  }

  async open(store: StoreWrapperInterface): Promise<void> {
    if (store.networkName == Networks.MAINNET || store.networkName == Networks.ELP) {
      // If using "mainnet", check for data under an 'elp' directory first. This is because older
      // versions of Ceramic only supported an 'elp' network as an alias for mainnet and stored
      // state store data under 'elp' instead of 'mainnet' by mistake, and we don't want to lose
      // that data if it exists.
      const hasPinnedStreams = !(await store.isEmpty())
      if (hasPinnedStreams) {
        this.#logger.verbose(
          `Detected existing state store data under 'elp' directory. Continuing to use 'elp' directory to store state store data`
        )
      }
    }
    return super.open(store)
  }

  async list(streamId?: StreamID | null, limit?: number): Promise<string[]> {
    if (streamId == null) {
      return await this.store.find({ limit })
    } else {
      const exists = Boolean(await this.load(streamId.baseID))
      return exists ? [streamId.toString()] : []
    }
  }
}
