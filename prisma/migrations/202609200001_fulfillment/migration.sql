ALTER TABLE "orders" ADD COLUMN "fulfillmentStage" TEXT NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE "orders" ADD CONSTRAINT "order_fulfillment_stage" CHECK ("fulfillmentStage" IN ('RECEIVED','COOKING','WAITING_DRIVER','SENT'));
ALTER TABLE "DeliveryTicket" ADD CONSTRAINT "ticket_stage" CHECK (stage IN ('RECEIVED','COOKING','WAITING_DRIVER','SENT'));
