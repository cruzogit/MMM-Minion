import { z } from "zod";
import { AUDIO_FORMATS_LABEL, isAllowedAudioType } from "./audio-types";
import {
  ATTACHMENT_BLOCKED_HINT, CLOSE_REASON_MAX, DEAL_NAME_MAX, DEAL_VALUE_MAX, FOLLOWUP_NOTES_MAX, isAllowedImageType, isAttachmentAllowed, MAX_ATTACHMENTS_PER_LEAD, maxFileBytes, maxFileLabel,
  MAX_CLOSE_FILES, MAX_FOLLOWUP_FILES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, MAX_ORIGINAL_IMAGE_BYTES, MAX_THUMBNAIL_BYTES, THUMBNAIL_TYPES,
} from "./constants";
import { isHttpUrl, isRealDay, normalizePhone } from "./format";

// .strict(): unknown fields (createdById, leadCode, deletedAt, ...) are rejected, never silently applied.

const optionalId = z.string().trim().max(64).nullable().optional().transform(v => v || null);
const optionalText = (max: number) =>
  z.string().trim().max(max, `At most ${max} characters`).nullable().optional().transform(v => v || null);

export const leadInputSchema = z
  .object({
    customerName: z.string({ required_error: "Customer Name is required" }).trim().min(2, "Customer Name is required").max(120),
    contactNumber: z
      .string({ required_error: "Contact Number is required" })
      .trim()
      .min(1, "Contact Number is required")
      .max(30)
      .refine(v => normalizePhone(v) !== null, "Enter a valid contact number (7–15 digits)"),
    // Which of these are required is set in Edit Page Layout and checked in the service (checkLeadAgainstLayout)
    taskAssignedPersonId: optionalId,
    productOrServiceId: optionalId,
    requirementId: optionalId,
    exactRequirement: optionalText(2000),
    modeOfCustomerId: optionalId,
    sourceId: optionalId,
    location: optionalText(200),
    exactLocation: optionalText(300),
    locationLink: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform(v => v || null)
      .refine(v => v === null || isHttpUrl(v), "Enter a valid http(s) link"),
    mainCategoryId: optionalId,
    subcategoryId: optionalId,
    leadPersonId: optionalId,
    leadStatusId: optionalId,
    amount: z.number().min(0, "Amount cannot be negative").max(9999999999.99).nullable().optional().transform(v => v ?? null),
    conventionalRate: z.number().min(0).max(100).nullable().optional().transform(v => v ?? null),
    notes: optionalText(5000),
    leadTypeId: optionalId,
    dailyTask: z.boolean().optional().default(false),
    // Values of fields added in Edit Page Layout, keyed by field key. Validated against the layout when saved.
    customFields: z.record(z.string().max(64), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])).optional().default({}),
  })
  .strict();
export type LeadInput = z.infer<typeof leadInputSchema>;

// Edit Deal: the lead form (the deal's customer, requirements, staff, location, ...) plus the deal's own details. Lead Status and Amount
// are not part of it: a deal has a Deal Status and its Amount is the Deal Value.
export const dealInputSchema = leadInputSchema.omit({ leadStatusId: true, amount: true }).extend({
  dealName: z.string({ required_error: "Deal Name is required" }).trim().min(1, "Deal Name is required").max(DEAL_NAME_MAX, `At most ${DEAL_NAME_MAX} characters`),
  closingDate: z.string({ required_error: "Closing Date is required" }).trim().refine(isRealDay, "Enter a valid Closing Date"),
  dealValue: z.number({ required_error: "Deal Value is required", invalid_type_error: "Deal Value must be a number" }).positive("Deal Value must be more than 0").max(DEAL_VALUE_MAX, "Deal Value is too large"),
  dealStatusId: optionalId,
});
export type DealInput = z.infer<typeof dealInputSchema>;

export const notesSchema = z.object({ notes: optionalText(5000) }).strict();

// Inline edit in the Leads table: one field at a time, with the same limits as the full lead form
export const leadFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("amount"), value: z.number().min(0, "Amount cannot be negative").max(9999999999.99, "Amount is too large").nullable() }).strict(),
  z.object({ field: z.literal("leadStatusId"), value: z.string().trim().min(1).max(64).nullable() }).strict(),
  z.object({ field: z.literal("location"), value: optionalText(200) }).strict(),
  z.object({ field: z.literal("exactLocation"), value: optionalText(300) }).strict(),
]);
export type LeadFieldInput = z.infer<typeof leadFieldSchema>;

// What the browser says about each image it already optimized (see image-optimize.ts). Display and bookkeeping
// only: the server re-checks the stored bytes itself after the upload.
const imageMetaSchema = z
  .object({
    width: z.number().int().min(1).max(MAX_IMAGE_WIDTH),
    height: z.number().int().min(1).max(MAX_IMAGE_HEIGHT),
    originalSize: z.number().int().positive().max(MAX_ORIGINAL_IMAGE_BYTES),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    thumbnail: z
      .object({ type: z.enum(THUMBNAIL_TYPES), size: z.number().int().positive().max(MAX_THUMBNAIL_BYTES, "Thumbnail is too large") })
      .strict(),
  })
  .strict();

// One file to upload. Documents (PDF, Office, CSV, ...) are sent as they are. Images (JPEG, PNG, WebP) must come
// with the optimization details and a thumbnail; any other image format is refused.
const uploadFileSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    type: z.string().trim().max(150),
    size: z.number().int().positive(),
    image: imageMetaSchema.optional(),
  })
  .strict()
  .refine(f => isAttachmentAllowed(f.name), `File type not allowed (${ATTACHMENT_BLOCKED_HINT})`)
  .refine(f => !f.type.startsWith("image/") || isAllowedImageType(f.type), "Only JPEG, PNG and WebP images are supported")
  .refine(f => !f.type.startsWith("audio/") || isAllowedAudioType(f.type), `Unsupported audio format (${AUDIO_FORMATS_LABEL})`)
  .refine(f => f.size <= maxFileBytes(f.type), f => ({ message: `File is larger than ${maxFileLabel(f.type)}` }))
  .refine(f => f.type.startsWith("image/") === !!f.image, "Images must be optimized before upload");
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

export const attachmentSignSchema = z.object({ files: z.array(uploadFileSchema).min(1).max(MAX_ATTACHMENTS_PER_LEAD) }).strict();

export const attachmentCompleteSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_ATTACHMENTS_PER_LEAD) }).strict();

// Follow-up proof: files + when the next follow-up is due + notes
export const followUpSchema = z
  .object({
    notes: z.string().trim().min(1, "Follow-up notes are required").max(FOLLOWUP_NOTES_MAX),
    taskName: z.string().trim().max(100).optional().nullable(),
    nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().nullable(),
    nextTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time").optional().nullable(),
    files: z.array(uploadFileSchema).min(1, "Select at least one file").max(MAX_FOLLOWUP_FILES),
  })
  .strict()
  .refine(v => !(v.nextTime && !v.nextDate), { message: "Choose a date as well as a time", path: ["nextDate"] });

export const followUpCompleteSchema = z.object({ followUpId: z.string().min(1).max(64) }).strict();
export type FollowUpInput = z.infer<typeof followUpSchema>;

// Close Lead: the reason is required, the files are optional
const CLOSE_REASON_REQUIRED = "Please provide a reason for closing this lead";
export const closeLeadSchema = z
  .object({
    reason: z.string({ required_error: CLOSE_REASON_REQUIRED }).trim().min(1, CLOSE_REASON_REQUIRED).max(CLOSE_REASON_MAX, `At most ${CLOSE_REASON_MAX} characters`),
    files: z.array(uploadFileSchema).max(MAX_CLOSE_FILES).optional().default([]),
  })
  .strict();
export type CloseLeadInput = z.infer<typeof closeLeadSchema>;

export const closeLeadCompleteSchema = z.object({ closureId: z.string().min(1).max(64) }).strict();

// Convert Lead: the three details the popup asks for. The Closing Date is a calendar day (YYYY-MM-DD); that it is not in the past
// is checked in the service, which knows the CRM time zone.
export const convertLeadSchema = z
  .object({
    dealName: z.string({ required_error: "Deal Name is required" }).trim().min(1, "Deal Name is required").max(DEAL_NAME_MAX, `At most ${DEAL_NAME_MAX} characters`),
    closingDate: z.string({ required_error: "Closing Date is required" }).trim().refine(isRealDay, "Enter a valid Closing Date"),
    dealValue: z.number({ required_error: "Deal Value is required", invalid_type_error: "Deal Value must be a number" }).positive("Deal Value must be more than 0").max(DEAL_VALUE_MAX, "Deal Value is too large"),
  })
  .strict();
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
