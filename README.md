# node-oncourse

This is a port of a ruby gem I made called [oncourse]("https://github.com/stevecd/ruby-oncourse").  Its purpose is to provide an API for managing teacher lesson plans on oncoursesystems.com.


## Installation
  
    $ npm install node-oncourse

## Usage

    var Client =  require("node-oncourse").Client;
    var fs = require("fs");
    
    // build a client
    var client = new Client("username", "password");

    // most methods in node-oncourse return promises
    
    // login returns true if login success.
    client.login(function(success) {
      if(success) {
        // we're logged in, parse the lesson plan for the week starting 2014-03-17
        // and the following week
        return client.getPlannerHTML("2014-03-17", 2);
      } else {
        throw new Error("Login failed!")
      }
    }).then(function() {
      // the lesson plan has been read, now fill out any linked standards 
      // or homework.
      return client.getPlannerStandards();
    }).then(function() {
      // standards have been read for these 2 weeks, now read any homework
      return client.getPlannerHomework();
    }).then(function() {
      // weekly lessons are stored in client.weeks as they're read and updated.
      // by this point we've logged in, parsed 2 weeks, and then filled in standards and homework
      // for each lesson in those weeks.

      // save it to a file for now.
      fs.writeFileSync("./lessonplan.json", JSON.stringify(client.weeks, null, 2));
    }).then(null, function(err) {
      console.log("Something exploded!: " + err.stack);
    });

## Contributing

1. Fork it ( http://github.com/stevecd/node-oncourse/fork )
2. Create your feature branch (git checkout -b my-new-feature)
3. Commit your changes (git commit -am 'Add some feature')
4. Push to the branch (git push origin my-new-feature)
5. Create new Pull Request
