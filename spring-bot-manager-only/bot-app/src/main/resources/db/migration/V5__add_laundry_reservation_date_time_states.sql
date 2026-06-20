-- The laundry_flow stored in the database is missing the reservation date/time
-- selection states (reservation_date, reservation_time and their await/process
-- counterparts). The reservation flow jumps straight to "reservation_date" after
-- language/menu navigation, so without these states the FlowEngine can't find
-- the target state and resets the conversation back to language_selection.
UPDATE businesses
SET config = jsonb_set(
    config,
    '{flows,laundry_flow,states}',
    (config -> 'flows' -> 'laundry_flow' -> 'states') || '{
        "reservation_date": {
            "id": "reservation_date",
            "type": "action",
            "action": "reservation.showDate",
            "next": "await_reservation_date"
        },
        "await_reservation_date": {
            "id": "await_reservation_date",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_date"
        },
        "process_reservation_date": {
            "id": "process_reservation_date",
            "type": "action",
            "action": "reservation.processDate"
        },
        "reservation_time": {
            "id": "reservation_time",
            "type": "action",
            "action": "reservation.showTime",
            "next": "await_reservation_time"
        },
        "await_reservation_time": {
            "id": "await_reservation_time",
            "type": "input",
            "saveAs": "userInput",
            "next": "process_reservation_time"
        },
        "process_reservation_time": {
            "id": "process_reservation_time",
            "type": "action",
            "action": "reservation.processTime"
        }
    }'::jsonb
)
WHERE bot_id = 'laundry'
  AND config -> 'flows' -> 'laundry_flow' -> 'states' ? 'reservation_confirm'
  AND NOT (config -> 'flows' -> 'laundry_flow' -> 'states' ? 'reservation_date');
