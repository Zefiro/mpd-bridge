import { Driver } from "zwave-js";

// Or when the application gets a SIGINT or SIGTERM signal
// Shutting down after SIGINT is optional, but the handler must exist
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        await driver.destroy();
        process.exit(0);
    });
}

// Tell the driver which serial port to use
const driver = new Driver("/dev/ttyZWave");
// You must add a handler for the error event before starting the driver
driver.on("error", (e) => {
    // Do something with it
    console.error(e);
});
// Listen for the driver ready event before doing anything with the driver
driver.once("driver ready", () => {
console.log("driver ready")
    /*
    Now the controller interview is complete. This means we know which nodes
    are included in the network, but they might not be ready yet.
    The node interview will continue in the background.
    */

    driver.controller.nodes.forEach((node) => {
console.log(node)
        // e.g. add event handlers to all known nodes
    });
console.log(driver.controller.nodes.length)
    // When a node is marked as ready, it is safe to control it
    const node = driver.controller.nodes.get(0);
    node.once("ready", async () => {
        // e.g. perform a BasicCC::Set with target value 50
console.log("node ready")
//        await node.commandClasses.Basic.set(50);
    });
});
// Start the driver. To await this method, put this line into an async method
await driver.start();

setTimeout(async () => { await driver.destroy(); }, 15000)

// When you want to exit:


