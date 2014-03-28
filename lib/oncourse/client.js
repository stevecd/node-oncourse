var cheerio = require('cheerio');
var Q = require('q');
var moment = require('moment');
var request = require('request');
var qrequest = Q.denodeify(request);
var qrGet = Q.denodeify(request.get);
var qrPost = Q.denodeify(request.post);

function Client(username, password) {
  this.username = username;
  this.password = password;
  this.urlBase = "http://www.oncoursesystems.com/";
  this.loginPath = "https://www.oncoursesystems.com/account/login"; //Username=<username>&Password=<password>
  this.urlPaths = {
    setPlanner: "planner/planner_frame.aspx", //date=20140310&user_id=<user_id>&template=N
    getPlanner: "planner/planner.aspx",
    closePlanner: "planner/planner_navigation_bar.aspx", //action=C&tabid=<tab_id>
    getStandardsOld: "json.axd/LessonPlan/references_linked", //{id: <standards_id>}
    getStandardsNew: "json.axd/standards/lesson_standards", //{userId: <userId>, date:<MM/DD/YYYY>,period:period}
    linkStandards: "json.axd/standards/link_standards",
    getStandardAreas: "json.axd/standards/lesson_standard_areas", //{setId: <standard_setId>}
    getStandardFilters: "json.axd/standards/lesson_standard_filters", //{setId: <standard_setId>,subject: <standard_subject>}
    getStandardsTree: "json.axd/standards/lesson_standards_tree",
    getLesson: "json.axd/LessonPlan/lesson_record",
    postLesson: "json.axd/LessonPlan/lesson_record_save",
    getLessonTree: "json.axd/LessonPlan/lesson_tree" //{userId: <user_id>}
  };
  this.userAgent = 'Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/32.0.1667.0 Safari/537.36';
  this.lastResponse = '';
}

// builds API urls given a method key
Client.prototype.buildUrl = function(key) {
  return this.urlBase + this.urlPaths[key];
};

// logs the client in and sets proper cookies.
Client.prototype.login = function() {
  var that = this;
  var deferred = Q.defer();
  return qrequest({
    method: 'POST',
    url: that.loginPath,
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      Username: that.username,
      Password: that.password
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response){
    var regex = new RegExp("\"user_id\":\"([0-9]+)\"");
    var match = regex.exec(response);
    if(response[0]) {
      if(match[1]) {
        that.userId = match[1];
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }, function(err) {
    console.log("Login request failed!");
  });
};

// Gets lesson plans by parsing the weekly lessonplan view on oncourse.
// This method only gets what's parseable on that one page, so it will not grab a list of
// standards, nor will it grab the homework field.
//
// In order to get standards for each lesson, you'll have to use getPlannerStandards after
// this call.
//
// In order to get homework for each lesson, use getPlannerHomework after this call.
Client.prototype.getPlannerHTML = function(startDate, numWeeks) {
  var that = this;
  var itr = 0;
  var sequence = Q.resolve();
  that.weeks = [];
  var startDates = [];
  for(var i = 0; i < numWeeks; i++) {
    startDates.push(moment(startDate).add('d', i * 7));
  }
  startDates.forEach(function(start) {
    var week = {
      start: start.format('YYYYMMDD'),
      columns: []
    };
    sequence = sequence.then(function() {
      //have to hit this first to set proper cookies
      return qrequest({
        url: that.buildUrl('setPlanner'),
        method: 'GET',
        qs: {
          date: week.start,
          user_id: that.userId,
          template: 'N'
        },
        headers: {
          'User-Agent': that.userAgent
        },
        jar: true,
        followAllRedirects: true
      });
    }).then(function() {

      //then we can hit this to get the html version of the
      //lesson planner
      return qrequest({
        url: that.buildUrl('getPlanner'),
        method: 'GET',
        headers: {
          'User-Agent': that.userAgent
        },
        jar: true,
        followAllRedirects: true
      });
    }).then(function(response) {
      var plannerFrame = response[1];
      that.lastResponse = response[1];
      var $ = cheerio.load(plannerFrame);
      var cells = [];

      //parse out planner column header text for labels
      $('tr.sheetRowHeader th:not(.sheetRow1stCell)').each(function(idx,el) {
        week.columns.push({
          label: $(el).text().trim(),
          period: idx + 1
        });
      });

      //parse out each cell, ids give date and period,
      //period corresponds to column number.
      //.lessonPreview classes contain the markup and content created by extjs's
      //text editor that teachers use for lesson input
      $('.sheetCell').each(function(idx, el) {
        var cell = {
          date: $(el).attr('id').slice(0,-2),
          period: parseInt($(el).attr('id').slice(-2)),
          html: $('.lessonPreview', $(el)).html()
        };
        var blueFlagElement = $('.sheetCellIcons img[src="/images/icons/flag_blue.png"]', $(el)).attr("onclick");
        if(blueFlagElement) {
          var regex = /[0-9]+/;
          cell.standardsId = regex.exec(blueFlagElement)[0];
        }

        // check for house icon, if it's present then this lesson has homework
        var houseElement = $('.sheetCellIcons img[src="/images/icons/house.png"]', $(el))[0];
        if(houseElement) {
          cell.hasHomework = true;
        }
        cells.push(cell);
      });
      week.columns.forEach(function(column) {
        column.cells = cells.filter(function(cell) { return cell.period === column.period; });
      });

      that.weeks.push(week);
    });
  });
  return sequence.then(function() {
    return that.weeks;
  });
};

// Calls getPlannerHTML for the weeks which include startDate and endDate
// and any weeks in between.
Client.prototype.getPlannerHTMLDateRange = function(startDate, endDate) {
  var that = this;
  startDate = moment(startDate).weekday(1);
  endDate = moment(endDate).weekday(1);

  // monday to Monday is 1 week, but in Oncourse you should read two weeks to include
  // that last Monday.
  var difference = endDate.diff(startDate, 'weeks') + 1;
  return that.getPlannerHTML(startDate, difference);
};

// Fills in lesson standards for the weeks instance variable
// this is to be called at some point after a getPlannerHTML call.
// The only way I've found of getting the proper standardId for this
// request is to parse it out of the HTML.  Haven't found a json method
// that returns the proper lessonId.
Client.prototype.getPlannerStandards = function() {
  var that = this;
  if(!that.weeks || that.weeks.length === 0) {
    throw new Error("Requested planner standards when weeks is empty.")
  }

  var sequence = Q.resolve();
  that.weeks.forEach(function(week) {
    week.columns.forEach(function(column) {
      column.cells.forEach(function(cell) {
        if(cell.standardsId) {
          sequence = sequence.then(function() {
            return that.getLinkedStandards(moment(cell.date, "YYYYMMDD").format("YYYY-MM-DD"), cell.period).then(function(standards) {
              cell.standards = standards;
            });
          });
        }
      });
    });
  });
  return sequence.then(function() {
    return that.weeks;
  });
};

//utility method to test if array of moment objects contains a specific moment
Client.prototype.momentIndexOf = function(array, m) {
  return array.some(function(el) {
    return el.isSame(m);
  });
};

//Finds the date for the first empty lesson after a given date
//that isn't in the optional skips array or on a weekend
Client.prototype.findLastLesson = function(date, period, skips) {
  var that = this;
  if(!skips) {
    skips = [];
  }
  var thisDate = moment(date);
  skips = skips.map(function(s) {return moment(s);});
  date = moment(date).add('day', 1);
  while(that.momentIndexOf(skips, date) || ~[0,6].indexOf(parseInt(date.weekday()))) {
    date.add('day', 1);
  }
  return that.getLesson(date.format("YYYY-MM-DD"), period).then(function(lesson) {
    if(lesson.homework.length > 0 || lesson.notes.length > 0) {
      return that.findLastLesson(date.format("YYYY-MM-DD"), period, skips);
    } else {
      return thisDate.format("YYYY-MM-DD");
    }
  });
};

//Grabs linked standards for a single lesson.
Client.prototype.getLinkedStandards = function(date,period) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('getStandardsNew'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      userId: that.userId,
      date: moment(date).format("MM/DD/YYYY"),
      period: period
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Fills in homework fields for each planner cell by calling 
// getLesson for each cell.date.
//
// Calling getLesson is the only way I've found so far to get the homework field.
//
// If you plan on editing and posting lessons, you should read the homework first, as
// calling postLesson with an empty homework field will blank out Oncourse's homework field.
Client.prototype.getPlannerHomework = function() {
  var that = this;
  if(!that.weeks || that.weeks.length === 0) {
    throw new Error("Requested planner homework when weeks is empty.")
  }

  var sequence = Q.resolve();
  that.weeks.forEach(function(week) {
    week.columns.forEach(function(column) {
      column.cells.forEach(function(cell) {
        if(cell.hasHomework && cell.date) {
          sequence = sequence.then(function() {
            return that.getLesson(moment(cell.date, "YYYYMMDD").format("YYYY-MM-DD"), cell.period).then(function(lesson) {
              cell.homework = lesson.homework;
            });
          });
        }
      });
    });
  });
  return sequence.then(function() {
    return that.weeks;
  });
};

// Reads one lesson given a specific period and date.
// This is one way I've identified of getting the homework field and should
// be called before posting a lesson in some cases.
//
// Say you've used getPlannerHTML to read a couple of weeks worth of lessons.
// Now, say you edit some of those lessons and want to post them back to oncourse.
// Since getPlannerHTML does not give you a homework field, if you post a lesson
// with an empty homework field, that field will be made empty on oncourse.
//
// So if you go that route and want to post updates to the lesson body's and keep
// the homework field the same, you'll need to read each lesson before posting to 
// get that homework field.  You would then pass that as the homework field in the
// postLesson method.
Client.prototype.getLesson = function(date, period) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('getLesson'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      userId: that.userId,
      date: moment(date).format("MM/DD/YYYY"),
      period: period
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]).ReturnValue;
  });
};

// This method gets that tree from the left side of the 'edit lesson' window of
// oncourse.  It contains some needed information for linking standards to lesson
// plans, but really only needs to be called once.
Client.prototype.getLessonTree = function(force) {
  var that = this;
  if(!force && that.lessonTree) {
    return Q.fcall(function() {
      return that.lessonTree;
    });
  }

  return qrequest({
    method: 'POST',
    url: that.buildUrl('getLessonTree'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      userId: that.userId
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    that.lessonTree = JSON.parse(response[1]);
    return that.lessonTree;
  });
};

// Gets the Standards branch of the lessonTree and extracts the 
// label and setId for each group of standards
Client.prototype.getStandardGroups = function() {
  var that = this;
  var sequence = Q.resolve();
  if(!that.lessonTree) {
    sequence = sequence.then(function() {
      return that.getLessonTree;
    });
  }

  return sequence.then(function() {
    var standardsBranch = that.lessonTree.filter(function(branch) {
      return branch.text === "Standards";
    })[0];

    return standardsBranch.children.map(function(child){
      return {
        label: child.text,
        setId: child.xconfig.setId
      };
    });
  });
};

// Gets the first child group of standards based on standard setId
Client.prototype.getStandardAreas = function(setId) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('getStandardAreas'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      setId: setId
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Gets the filters that must be applied after selecting first standard child group
Client.prototype.getLessonStandardFilters = function(setId, subject) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('getStandardFilters'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      setId: setId,
      subject: subject
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Gets a full list of standards for a given setId, subject, grade, and year
// you can get the grade and year from getLessonStandardFilters.
Client.prototype.getLessonStandardsTree = function(setId, subject, grade, year) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('getStandardTree'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      userId: that.userId,
      setId: setId,
      subject: subject,
      yearName: year,
      searchText1: "",
      searchOperator: "",
      searchText2: "",
      mapID: "",
      grade: grade,
      showOnlyPowerSet: false,
      activityDate: moment().format("MM/DD/YYYY"), // arbitrary?
      activityPeriod: 1 //arbitrary??
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Links a standard to a lesson given a specific date and period for that lesson.
Client.prototype.linkStandard = function(standardId, date, period) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('linkStandards'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      objectType: "L",
      id: standardId,
      date: moment(date).format("MM/DD/YYYY"),
      period: period,
      link: true
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Unlinks a standard from a lesson given a specfic date and period for that lesson.
Client.prototype.unlinkStandard = function(standardId, date, period) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('linkStandards'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      objectType: "L",
      id: standardId,
      date: moment(date).format("MM/DD/YYYY"),
      period: period,
      link: false
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};

// Posts a lesson to oncourse.
// IMPORTANT: This method will absolutely and forever OVERWRITE any information that occupies
// this specific date and period on oncourse.  Oncourse does not appear to keep revision history
// on lesson plans!
//
// To do this carefully, one should carefully backup each lesson before posting!
//
// You can do this using getLesson.
//
// ** Get Lesson is the only way to grab the homework section!
//
// If you only use getPlannerHTML, all you'll have is the lesson bodies, you still need
// to use getLesson for homework and store those values somewhere safe in order to have a full copy of what's
// on oncourse.
Client.prototype.postLesson = function(lessonHTML, homeworkHTML, date, period) {
  var that = this;
  return qrequest({
    method: 'POST',
    url: that.buildUrl('postLesson'),
    headers: {
      'User-Agent': that.userAgent
    },
    form: {
      userId: that.userId,
      date: moment(date).format("MM/DD/YYYY"),
      period: period,
      notes: lessonHTML,
      homework: homeworkHTML
    },
    followAllRedirects: true,
    jar: true
  }).then(function(response) {
    return JSON.parse(response[1]);
  });
};
module.exports = Client;
