import { pgTable, uuid, varchar, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';
import { clients } from './clients';

/**
 * Tags table (TASK-0010).
 * Stores studio-defined labels for categorizing clients.
 */
export const tags = pgTable('tags', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  name: varchar('name', { length: 50 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 50 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

/**
 * Client tags join table (TASK-0010).
 * Many-to-many relationship between clients and tags.
 */
export const clientTags = pgTable(
  'client_tags',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.tagId] }),
    index('client_tags_tag_id_idx').on(table.tagId),
  ],
);

export type ClientTag = typeof clientTags.$inferSelect;
export type NewClientTag = typeof clientTags.$inferInsert;
