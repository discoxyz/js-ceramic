import PQueue from 'p-queue'
import type { DiagnosticsLogger } from '@ceramicnetwork/common'
import { empty, from, Observable } from 'rxjs'
import type { Subscription } from 'rxjs'
import type { PubsubMessage } from './pubsub-message.js'
import type { ObservableWithNext } from './observable-with-next.js'
import { MsgType } from './pubsub-message.js'

/**
 * The returned Promise resolves when the +subscription+ is done.
 */
export function whenSubscriptionDone(subscription: Subscription): Promise<void> {
  return new Promise<void>((resolve) => subscription.add(resolve))
}

/**
 * Wraps an instance of Pubsub and rate limits how often QUERY messages can be sent.  There are two
 * main configuration parameters: 'queriesPerSecond' and 'maxQueuedQueries'. 'queriesPerSecond'
 * controls how many QUERY pubsub messages can be published per second.  If more than that number
 * of query messages are attempted to be published, additional messages will queue up and will be
 * published when doing so will no longer put us over 'queriesPerSecond'.  'maxQueuedQueries'
 * controls how many queries are allowed to queue up before further attempts to publish query
 * messages just start failing outright.
 *
 * Note that other types of pubsub messages that are not QUERY messages are allowed to be published
 * without limit.
 */
export class PubsubRateLimit
  extends Observable<PubsubMessage>
  implements ObservableWithNext<PubsubMessage>
{
  /**
   * Queue of QueryMessages to publish.
   */
  readonly queue: PQueue

  /**
   * Maximum amount of QueryMessages allowed to hang in memory.
   * A new message over the limit gets bounced off.
   */
  readonly maxQueuedQueries: number

  /**
   * Constructs a new instance of PubsubRateLimit.
   * @param pubsub - the underlying Pubsub instance to publish messages to.
   * @param logger
   * @param queriesPerSecond - Max number of query messages that can be published per second
   *   before they start to queue up.
   */
  constructor(
    private readonly pubsub: ObservableWithNext<PubsubMessage>,
    private readonly logger: DiagnosticsLogger,
    private readonly queriesPerSecond: number
  ) {
    super((subscriber) => {
      pubsub.subscribe(subscriber)
    })

    // Limit number of executions by +intervalCap+ in +interval+ milliseconds.
    // Here it is +queriesPerSecond+ per 1000ms = 1 second.
    this.queue = new PQueue({ interval: 1000, intervalCap: queriesPerSecond })

    this.maxQueuedQueries = queriesPerSecond * 10

    this.logger.debug(
      `Configuring pubsub to rate limit query messages to ${queriesPerSecond} per second`
    )
  }

  /**
   * For non-query messages simply passes the message directly through to pubsub. For query messages,
   * queues the messages up to be published so long as we aren't exceeding the rate limit.
   * @param message
   */
  next(message: PubsubMessage): Subscription {
    if (message.typ === MsgType.QUERY) {
      if (this.queue.size >= this.maxQueuedQueries) {
        this.logger.err(
          `Cannot publish query message to pubsub because we have exceeded the maximum allowed rate. Cannot have more than ${this.maxQueuedQueries} queued queries.`
        )
        return empty().subscribe()
      }
      return from(this.queue.add(() => whenSubscriptionDone(this.pubsub.next(message)))).subscribe()
    } else {
      return this.pubsub.next(message)
    }
  }
}
