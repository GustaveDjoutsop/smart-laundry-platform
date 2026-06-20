Key to remember for next restart — always start the backend with these 4 env vars:


DATABASE_URL=jdbc:postgresql://localhost:15432/smartbot
DATABASE_USERNAME=smartbot
DATABASE_PASSWORD=smartbot
ENCRYPTION_MASTER_KEY=e241caf0cf38068f464e456fcba581a35eecd1261d8c64c8121a63c006139429

## Always with docker desktop:
$env:ENCRYPTION_MASTER_KEY = "e241caf0cf38068f464e456fcba581a35eecd1261d8c64c8121a63c006139429"
 docker-compose up -d
 $env:SPRING_PROFILES_ACTIVE = "local" ; mvn -pl bot-app spring-boot:run


## From the bot-app directory, run:

cd "C:\Users\sunda\Codierung\spring-bot-manager\bot-app"
DATABASE_URL="jdbc:postgresql://localhost:15432/smartbot" DATABASE_USERNAME="smartbot" DATABASE_PASSWORD="smartbot" ENCRYPTION_MASTER_KEY="e241caf0cf38068f464e456fcba581a35eecd1261d8c64c8121a63c006139429" mvn spring-boot:run

## Using windows cmd (not Git Bash)
$env:DATABASE_URL = "jdbc:postgresql://localhost:15432/smartbot"
$env:DATABASE_USERNAME = "smartbot"
$env:DATABASE_PASSWORD = "smartbot"
$env:ENCRYPTION_MASTER_KEY = "e241caf0cf38068f464e456fcba581a35eecd1261d8c64c8121a63c006139429"

cd "C:\Users\sunda\Codierung\spring-bot-manager\bot-app"
mvn spring-boot:run


## LOGIN
admin.username=admin
admin.password=change-me-in-production

## URL-LAUNDRY
https://smartlaundry-2ac76a884b66.herokuapp.com/api/webhook/whatsapp

https://1c7c-188-188-121-29.ngrok-free.app/api/whatsapp/webhooks/laundry

https://d5c5-217-241-28-162.ngrok-free.app/api/whatsapp/webhooks/laundry

laundry-phoneNumberId": "954151401109786",
